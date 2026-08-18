import '../polyfills';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Asset, ConverterContext, Metric } from '../types';
import { canvasToBlob, safeAssetName, stemOf, uniqueAssetName } from '../utils/files';
import {
  looksMathematical,
  markdownTable,
  normalizeMarkdown,
  unicodeMathToLatex,
} from '../utils/markdown';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfLoadingTask = ReturnType<typeof pdfjs.getDocument>;
type PdfDocument = Awaited<PdfLoadingTask['promise']>;
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
type PdfTextContent = Awaited<ReturnType<PdfPage['getTextContent']>>;

interface TextPiece {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bold: boolean;
  italic: boolean;
  hasEol: boolean;
  confidence: number;
  link?: string;
}

interface PdfLine {
  text: string;
  cells: string[];
  cellXs: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  gapAfter: number;
  boldRatio: number;
  italicRatio: number;
  centered: boolean;
  hasEol: boolean;
}

interface PageModel {
  pageNumber: number;
  width: number;
  height: number;
  lines: PdfLine[];
  scanned: boolean;
  ocrConfidence?: number;
  multiColumn: boolean;
  visualAsset?: string;
  tableCount: number;
  equationCount: number;
  linkCount: number;
}

interface PdfConversion {
  markdown: string;
  assets: Asset[];
  metrics: Metric[];
  warnings: string[];
  sourceType: string;
  pageCount: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle] ?? 0
    : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function normalizePdfText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeAnnotationUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const url = value.trim();
  return /^(?:https?:|mailto:)/i.test(url) ? url : undefined;
}

async function applyLinkAnnotations(page: PdfPage, pieces: TextPiece[]): Promise<number> {
  const annotations = await page.getAnnotations({ intent: 'display' }).catch(() => []);
  const linked = new Set<string>();
  for (const annotation of annotations) {
    const url = safeAnnotationUrl(annotation.url ?? annotation.unsafeUrl);
    const rect = annotation.rect;
    if (!url || !Array.isArray(rect) || rect.length < 4) continue;
    const left = Math.min(rect[0] ?? 0, rect[2] ?? 0);
    const right = Math.max(rect[0] ?? 0, rect[2] ?? 0);
    const bottom = Math.min(rect[1] ?? 0, rect[3] ?? 0);
    const top = Math.max(rect[1] ?? 0, rect[3] ?? 0);
    let matched = false;
    for (const piece of pieces) {
      const centerX = piece.x + piece.width / 2;
      const centerY = piece.y + piece.height / 2;
      if (centerX >= left - 2 && centerX <= right + 2 && centerY >= bottom - 3 && centerY <= top + 3) {
        piece.link = url;
        matched = true;
      }
    }
    if (matched) linked.add(url);
  }
  return linked.size;
}

function textPieces(content: PdfTextContent): TextPiece[] {
  const pieces: TextPiece[] = [];
  const seen = new Set<string>();
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const transform = item.transform;
    const text = normalizePdfText(item.str);
    if (!text) continue;
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    const duplicateKey = `${text}|${x.toFixed(1)}|${y.toFixed(1)}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    const fontName = item.fontName ?? '';
    const fontFamily = content.styles[fontName]?.fontFamily ?? '';
    const fontIdentity = `${fontName} ${fontFamily}`;
    pieces.push({
      text,
      x,
      y,
      width: Math.abs(item.width),
      height: Math.max(Math.hypot(transform[2] ?? 0, transform[3] ?? 0), Math.abs(item.height), 1),
      bold: /bold|black|heavy|semibold|demi/i.test(fontIdentity),
      italic: /italic|oblique/i.test(fontIdentity),
      hasEol: Boolean(item.hasEOL),
      confidence: 100,
    });
  }
  return pieces;
}

function groupRows(pieces: TextPiece[]): TextPiece[][] {
  const rows: TextPiece[][] = [];
  const ordered = [...pieces].sort((left, right) => right.y - left.y || left.x - right.x);
  for (const piece of ordered) {
    const tolerance = Math.max(2.25, piece.height * 0.28);
    const row = rows.find((candidate) => Math.abs((candidate[0]?.y ?? 0) - piece.y) <= tolerance);
    if (row) row.push(piece);
    else rows.push([piece]);
  }
  return rows
    .map((row) => row.sort((left, right) => left.x - right.x))
    .sort((left, right) => (right[0]?.y ?? 0) - (left[0]?.y ?? 0));
}

function orderRowsForColumns(rows: TextPiece[][], pageWidth: number): { rows: TextPiece[][]; multiColumn: boolean } {
  const bounds = rows.map((row) => ({
    row,
    start: row[0]?.x ?? 0,
    end: (row.at(-1)?.x ?? 0) + (row.at(-1)?.width ?? 0),
    y: row[0]?.y ?? 0,
  }));
  const leftCandidates = bounds.filter(({ start, end }) => start < pageWidth * 0.34 && end < pageWidth * 0.59);
  const rightCandidates = bounds.filter(({ start, end }) => start > pageWidth * 0.41 && end > pageWidth * 0.66);
  if (leftCandidates.length < 3 || rightCandidates.length < 3) return { rows, multiColumn: false };

  const leftEnd = median(leftCandidates.map(({ end }) => end));
  const rightStart = median(rightCandidates.map(({ start }) => start));
  const splitX = (leftEnd + rightStart) / 2;
  if (rightStart - leftEnd < pageWidth * 0.035 || splitX < pageWidth * 0.32 || splitX > pageWidth * 0.68) {
    return { rows, multiColumn: false };
  }

  const topY = Math.min(
    Math.max(...leftCandidates.map(({ y }) => y)),
    Math.max(...rightCandidates.map(({ y }) => y)),
  );
  const bottomY = Math.max(
    Math.min(...leftCandidates.map(({ y }) => y)),
    Math.min(...rightCandidates.map(({ y }) => y)),
  );
  if (topY <= bottomY) return { rows, multiColumn: false };
  const top: TextPiece[][] = [];
  const bottom: TextPiece[][] = [];
  const left: TextPiece[][] = [];
  const right: TextPiece[][] = [];

  for (const row of rows) {
    const y = row[0]?.y ?? 0;
    const rowStart = row[0]?.x ?? 0;
    const rowEnd = (row.at(-1)?.x ?? 0) + (row.at(-1)?.width ?? 0);
    const spanning = rowStart < splitX - pageWidth * 0.035 && rowEnd > splitX + pageWidth * 0.035;
    if (y > topY + 2 || (spanning && y >= topY - 2)) top.push(row);
    else if (y < bottomY - 2 || (spanning && y <= bottomY + 2)) bottom.push(row);
    else {
      const leftPieces = row.filter((piece) => piece.x + piece.width / 2 < splitX);
      const rightPieces = row.filter((piece) => piece.x + piece.width / 2 >= splitX);
      if (leftPieces.length) left.push(leftPieces);
      if (rightPieces.length) right.push(rightPieces);
    }
  }
  const sort = (items: TextPiece[][]) => items.sort((a, b) => (b[0]?.y ?? 0) - (a[0]?.y ?? 0));
  return { rows: [...sort(top), ...sort(left), ...sort(right), ...sort(bottom)], multiColumn: true };
}

function pieceSequenceText(group: TextPiece[], typicalCharacterWidth: number): string {
  let text = '';
  let openLink: string | undefined;
  const closeLink = (): void => {
    if (!openLink) return;
    text += `](${openLink.replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
    openLink = undefined;
  };
  for (let index = 0; index < group.length; index += 1) {
    const piece = group[index];
    if (!piece) continue;
    const previous = group[index - 1];
    const gap = previous ? piece.x - (previous.x + previous.width) : 0;
    const punctuation = /^[,.;:!?%)\]}]/.test(piece.text);
    const previousOpens = /[(\[{/]$/.test(previous?.text ?? '');
    const needsSpace = Boolean(previous && !punctuation && !previousOpens && gap > Math.max(1.1, typicalCharacterWidth * 0.34));
    if (piece.link !== openLink) {
      closeLink();
      if (needsSpace) text += ' ';
      if (piece.link) {
        openLink = piece.link;
        text += '[';
      }
    } else if (needsSpace) {
      text += ' ';
    }
    text += openLink ? piece.text.replace(/([\[\]])/g, '\\$1') : piece.text;
  }
  closeLink();
  return text.replace(/\s+([,.;:!?%])/g, '$1').trim();
}

function joinPieces(row: TextPiece[]): {
  text: string;
  cells: string[];
  cellXs: number[];
  boldRatio: number;
  italicRatio: number;
  hasEol: boolean;
} {
  if (!row.length) return { text: '', cells: [], cellXs: [], boldRatio: 0, italicRatio: 0, hasEol: false };
  const typicalHeight = median(row.map((piece) => piece.height)) || 10;
  const typicalCharacterWidth = median(row.map((piece) => piece.width / Math.max(1, Array.from(piece.text).length)).filter(Boolean)) || typicalHeight * 0.45;
  const cellGroups: TextPiece[][] = [[]];
  for (let index = 0; index < row.length; index += 1) {
    const piece = row[index];
    if (!piece) continue;
    const previous = row[index - 1];
    const gap = previous ? piece.x - (previous.x + previous.width) : 0;
    if (previous && gap > Math.max(typicalHeight * 1.45, typicalCharacterWidth * 3.6)) cellGroups.push([]);
    cellGroups.at(-1)?.push(piece);
  }
  const cells = cellGroups.map((group) => pieceSequenceText(group, typicalCharacterWidth)).filter(Boolean);
  const cellXs = cellGroups.map((group) => group[0]?.x ?? 0);
  const characterCount = row.reduce((sum, piece) => sum + Math.max(1, piece.text.length), 0);
  const boldCharacters = row.reduce((sum, piece) => sum + (piece.bold ? Math.max(1, piece.text.length) : 0), 0);
  const italicCharacters = row.reduce((sum, piece) => sum + (piece.italic ? Math.max(1, piece.text.length) : 0), 0);
  return {
    text: pieceSequenceText(row, typicalCharacterWidth),
    cells,
    cellXs,
    boldRatio: boldCharacters / characterCount,
    italicRatio: italicCharacters / characterCount,
    hasEol: row.some((piece) => piece.hasEol),
  };
}

function linesFromPieces(pieces: TextPiece[], pageWidth: number): { lines: PdfLine[]; multiColumn: boolean } {
  const grouped = groupRows(pieces);
  const ordered = orderRowsForColumns(grouped, pageWidth);
  const lines = ordered.rows.map((row, index) => {
    const joined = joinPieces(row);
    const first = row[0];
    const last = row.at(-1);
    const next = ordered.rows[index + 1];
    return {
      text: joined.text,
      cells: joined.cells,
      cellXs: joined.cellXs,
      x: first?.x ?? 0,
      y: first?.y ?? 0,
      width: last ? last.x + last.width - (first?.x ?? 0) : 0,
      height: median(row.map((piece) => piece.height)),
      gapAfter: Math.abs((first?.y ?? 0) - (next?.[0]?.y ?? 0)),
      boldRatio: joined.boldRatio,
      italicRatio: joined.italicRatio,
      centered: Boolean(first && last && Math.abs((first.x + last.x + last.width) / 2 - pageWidth / 2) < pageWidth * 0.065),
      hasEol: joined.hasEol,
    };
  });
  return { lines, multiColumn: ordered.multiColumn };
}

interface TableRun {
  length: number;
  columns: number;
}

function stableTableRun(lines: PdfLine[], index: number, pageWidth: number): TableRun | undefined {
  const first = lines[index];
  if (!first || first.cells.length < 2) return undefined;
  const anchorTolerance = Math.max(pageWidth * 0.018, first.height * 0.9);
  let length = 1;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    const previous = lines[cursor - 1];
    if (!line || line.cells.length < 2 || Math.abs(line.cells.length - first.cells.length) > 1) break;
    if (!previous || previous.gapAfter > Math.max(28, previous.height * 2.7)) break;
    const matchedAnchors = first.cellXs.filter((anchor) => line.cellXs.some((candidate) => Math.abs(candidate - anchor) <= anchorTolerance)).length;
    if (matchedAnchors / Math.max(first.cellXs.length, line.cellXs.length) < 0.6) break;
    length += 1;
  }
  if (length < 2) return undefined;
  const run = lines.slice(index, index + length);
  const columnCount = Math.max(...run.map((line) => line.cells.length));
  const hasDataSignal = run.slice(1).some((line) => line.cells.some((cell) => /\d|[%$€£¥]|^(?:yes|no|true|false)$/i.test(cell)));
  const headerContrast = (first.boldRatio - median(run.slice(1).map((line) => line.boldRatio))) > 0.18;
  if (length === 2 && columnCount === 2 && !hasDataSignal && !headerContrast) return undefined;
  return { length, columns: columnCount };
}

function dominantLineHeight(lines: PdfLine[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    if (!line.height || !line.text) continue;
    const bucket = Math.round(line.height * 2) / 2;
    weights.set(bucket, (weights.get(bucket) ?? 0) + Math.min(120, line.text.length));
  }
  const dominant = Array.from(weights.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
  return dominant || median(lines.map((line) => line.height).filter(Boolean)) || 10;
}

function repairedLineText(lines: PdfLine[], enabled: boolean): string[] {
  const output = lines.map((line) => line.text);
  if (!enabled) return output;
  for (let index = 0; index < output.length - 1; index += 1) {
    const current = output[index] ?? '';
    const next = output[index + 1] ?? '';
    if (/\p{Ll}{2,}-$/u.test(current) && /^\p{Ll}/u.test(next.trim()) && !/[–—]$/.test(current)) {
      output[index] = current.slice(0, -1) + next.trim();
      output[index + 1] = '';
    }
  }
  return output;
}

function headingLevel(line: PdfLine, bodyHeight: number): number | undefined {
  const text = line.text.trim();
  if (text.length < 2 || text.length > 150 || /[.!?;:]$/.test(text) || looksMathematical(text)) return undefined;
  if (/^(?:figure|fig\.?|table|algorithm|equation)\s*\d+/i.test(text)) return undefined;
  const ratio = line.height / Math.max(bodyHeight, 1);
  const letters = text.match(/[A-Za-z]/g) ?? [];
  const uppercase = letters.length >= 3 && letters.filter((letter) => letter === letter.toUpperCase()).length / letters.length > 0.82;
  if (ratio >= 1.72) return 2;
  if (ratio >= 1.38 || (ratio >= 1.25 && line.centered)) return 3;
  if ((ratio >= 1.12 && line.boldRatio >= 0.55) || (line.boldRatio >= 0.82 && text.length < 90) || (uppercase && ratio >= 1.03)) return 4;
  return undefined;
}

interface PageMarkdown {
  markdown: string;
  headings: number;
  captions: number;
}

function pageLinesToMarkdown(page: PageModel, ignored: Set<string>, dehyphenate: boolean): PageMarkdown {
  const lines = repairedLineText(page.lines, dehyphenate);
  const bodyHeight = dominantLineHeight(page.lines);
  const parts: string[] = [];
  let paragraph: string[] = [];
  const footnotes: string[] = [];
  let headingCount = 0;
  let captionCount = 0;
  const flush = (): void => {
    if (!paragraph.length) return;
    parts.push(paragraph.join(' ').replace(/\s+/g, ' ').trim());
    paragraph = [];
  };

  for (let index = 0; index < page.lines.length; index += 1) {
    const line = page.lines[index];
    if (!line) continue;
    const text = lines[index]?.trim() ?? '';
    const normalized = text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
    if (!text || ignored.has(normalized)) continue;

    const table = stableTableRun(page.lines, index, page.width);
    if (table) {
      flush();
      const rows = page.lines.slice(index, index + table.length).map((tableLine) => tableLine.cells);
      parts.push(markdownTable(rows));
      index += table.length - 1;
      continue;
    }

    const level = headingLevel({ ...line, text }, bodyHeight);
    if (level) {
      flush();
      parts.push(`${'#'.repeat(level)} ${text}`);
      headingCount += 1;
      continue;
    }
    if (looksMathematical(text)) {
      flush();
      const equationLines = [text];
      while (index + 1 < page.lines.length) {
        const nextText = lines[index + 1]?.trim() ?? '';
        const nextLine = page.lines[index + 1];
        const currentLine = page.lines[index];
        if (!nextLine || !currentLine || !looksMathematical(nextText) || currentLine.gapAfter > bodyHeight * 2.2) break;
        equationLines.push(nextText);
        index += 1;
      }
      parts.push(`$$\n${equationLines.map((equation) => unicodeMathToLatex(equation.replace(/−/g, '-'))).join('\n')}\n$$`);
      continue;
    }
    if (/^(?:[•▪◦‣]|[-–—])\s+/.test(text)) {
      flush();
      parts.push(`- ${text.replace(/^(?:[•▪◦‣]|[-–—])\s+/, '')}`);
      continue;
    }
    if (/^\d+[.)]\s+/.test(text)) {
      flush();
      parts.push(text.replace(/^(\d+)[.)]\s+/, '$1. '));
      continue;
    }
    if (/^(?:figure|fig\.?|table|algorithm|equation)\s*\d+/i.test(text)) {
      flush();
      parts.push(`*${text.replace(/\*/g, '\\*')}*`);
      captionCount += 1;
      continue;
    }
    if (line.height < bodyHeight * 0.8 && line.y < page.height * 0.17 && text.length < 260) {
      flush();
      const id = `p${page.pageNumber}-${footnotes.length + 1}`;
      footnotes.push(`[^${id}]: ${text.replace(/^\s*(?:\d+|[*†‡])\s*/, '')}`);
      continue;
    }
    paragraph.push(text);
    if (/[.!?:;]$/.test(text) || line.gapAfter > bodyHeight * 1.65 || line.hasEol && line.gapAfter > bodyHeight * 1.3) flush();
  }
  flush();
  if (footnotes.length) parts.push(footnotes.join('\n'));
  return { markdown: parts.join('\n\n'), headings: headingCount, captions: captionCount };
}

function repeatedMargins(pages: PageModel[]): Set<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const candidates = page.lines.filter((line) => (
      line.y > page.height * 0.88 || line.y < page.height * 0.12
    ) && line.text.length < 180);
    const unique = new Set(candidates.map((line) => line.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()).filter(Boolean));
    for (const candidate of unique) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  return new Set(Array.from(counts.entries()).filter(([, count]) => count >= threshold).map(([text]) => text));
}

async function renderPage(page: PdfPage, scale = 2.2): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const canvasContext = canvas.getContext('2d', { alpha: false });
  if (!canvasContext) throw new Error('Canvas rendering is not supported in this browser.');
  await page.render({ canvas, canvasContext, viewport }).promise;
  return canvas;
}

interface OcrResult {
  pieces: TextPiece[];
  confidence: number;
}

interface OcrSession {
  recognize: (canvas: HTMLCanvasElement, onProgress: (percent: number) => void) => Promise<OcrResult>;
  terminate: () => Promise<void>;
}

async function createOcrSession(): Promise<OcrSession> {
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  let progressListener: ((percent: number) => void) | undefined;
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    logger: (message) => {
      if (message.status === 'recognizing text') progressListener?.(Math.round((message.progress ?? 0) * 100));
    },
  });
  await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: PSM.AUTO });
  return {
    async recognize(canvas, onProgress) {
      progressListener = onProgress;
      const recognition = await worker.recognize(
        canvas,
        { rotateAuto: true },
        { text: true, blocks: true },
      );
      const pieces: TextPiece[] = [];
      for (const block of recognition.data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            for (let index = 0; index < line.words.length; index += 1) {
              const word = line.words[index];
              const text = normalizePdfText(word?.text ?? '');
              if (!word || !text) continue;
              pieces.push({
                text,
                x: word.bbox.x0,
                y: canvas.height - word.bbox.y1,
                width: Math.max(1, word.bbox.x1 - word.bbox.x0),
                height: Math.max(1, word.bbox.y1 - word.bbox.y0),
                bold: /bold|black|heavy|semibold/i.test(word.font_name ?? ''),
                italic: /italic|oblique/i.test(word.font_name ?? ''),
                hasEol: index === line.words.length - 1,
                confidence: word.confidence,
              });
            }
          }
        }
      }
      if (!pieces.length) {
        const lines = recognition.data.text.split(/\r?\n/).map(normalizePdfText).filter(Boolean);
        const lineHeight = Math.max(18, canvas.height / Math.max(40, lines.length + 8));
        pieces.push(...lines.map((text, index) => ({
          text,
          x: canvas.width * 0.06,
          y: canvas.height - (index + 3) * lineHeight,
          width: Math.min(canvas.width * 0.88, text.length * lineHeight * 0.46),
          height: lineHeight * 0.72,
          bold: false,
          italic: false,
          hasEol: true,
          confidence: recognition.data.confidence,
        })));
      }
      progressListener = undefined;
      return { pieces, confidence: recognition.data.confidence };
    },
    async terminate() {
      progressListener = undefined;
      await worker.terminate();
    },
  };
}

async function hasVisualOperators(page: PdfPage): Promise<boolean> {
  const operations = await page.getOperatorList();
  const imageCodes = new Set([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintSolidColorImageMask,
  ]);
  const pathCodes = new Set([pdfjs.OPS.constructPath, pdfjs.OPS.stroke, pdfjs.OPS.fill, pdfjs.OPS.eoFill]);
  let pathCount = 0;
  for (const code of operations.fnArray) {
    if (imageCodes.has(code)) return true;
    if (code === pdfjs.OPS.shadingFill) return true;
    if (pathCodes.has(code)) pathCount += 1;
  }
  return pathCount > 24;
}

export async function convertPdf(
  file: File,
  buffer: ArrayBuffer,
  context: ConverterContext,
): Promise<PdfConversion> {
  context.onProgress({ phase: 'Opening PDF', percent: 6, detail: 'Validating cross-reference tables' });
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: true });
  const documentProxy = await loadingTask.promise;
  const metadata = await documentProxy.getMetadata().catch(() => undefined);
  const assets: Asset[] = [];
  const pages: PageModel[] = [];
  const warnings: string[] = [];
  let scannedPages = 0;
  let visualPages = 0;
  let ocrSession: OcrSession | undefined;

  try {
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      const basePercent = 8 + ((pageNumber - 1) / documentProxy.numPages) * 74;
      context.onProgress({ phase: `Analysing page ${pageNumber} of ${documentProxy.numPages}`, percent: Math.round(basePercent), detail: 'Reading font, text geometry and layout' });
      const page = await documentProxy.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ includeMarkedContent: true, disableNormalization: false });
      let pieces = textPieces(content);
      let layoutWidth = viewport.width;
      let layoutHeight = viewport.height;
      let ocrConfidence: number | undefined;
      const digitalCharacters = pieces.reduce((sum, piece) => sum + piece.text.length, 0);
      const scanned = digitalCharacters < 32;
      let linkCount = scanned ? 0 : await applyLinkAnnotations(page, pieces);
      let canvas: HTMLCanvasElement | undefined;

      if (scanned) {
        scannedPages += 1;
        if (context.options.runOcr) {
          canvas = await renderPage(page, 2.6);
          layoutWidth = canvas.width;
          layoutHeight = canvas.height;
          context.onProgress({ phase: `OCR page ${pageNumber}`, percent: Math.round(basePercent + 2), detail: 'Reconstructing words from local OCR geometry' });
          try {
            ocrSession ??= await createOcrSession();
            const recognition = await ocrSession.recognize(canvas, (progress) => {
              context.onProgress({ phase: `OCR page ${pageNumber}`, percent: Math.min(88, Math.round(basePercent + progress * 0.08)), detail: `${progress}% recognised` });
            });
            pieces = recognition.pieces;
            ocrConfidence = recognition.confidence;
            linkCount = 0;
            if (recognition.confidence < 78) warnings.push(`Page ${pageNumber} OCR confidence was ${Math.round(recognition.confidence)}%; proofread it against the preserved page image.`);
          } catch (error) {
            pieces = [];
            warnings.push(`OCR could not read page ${pageNumber}: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          warnings.push(`Page ${pageNumber} appears scanned and OCR was disabled.`);
        }
      }

      const geometric = linesFromPieces(pieces, layoutWidth);
      const equationCount = geometric.lines.filter((line) => looksMathematical(line.text)).length;
      let tableCount = 0;
      for (let index = 0; index < geometric.lines.length; index += 1) {
        const table = stableTableRun(geometric.lines, index, layoutWidth);
        if (table) {
          tableCount += 1;
          index += table.length - 1;
        }
      }
      const visual = context.options.preserveVisualPages && (
        scanned || tableCount > 0 || equationCount > 0 || await hasVisualOperators(page)
      );
      let visualAsset: string | undefined;
      if (visual) {
        visualPages += 1;
        canvas ??= await renderPage(page);
        const name = uniqueAssetName(safeAssetName(`page-${pageNumber}-visual.png`), assets);
        assets.push({ name, blob: await canvasToBlob(canvas), kind: 'image', source: `PDF page ${pageNumber} · ${canvas.width}×${canvas.height}` });
        visualAsset = name;
      }
      pages.push({
        pageNumber,
        width: layoutWidth,
        height: layoutHeight,
        lines: geometric.lines,
        scanned,
        ocrConfidence,
        multiColumn: geometric.multiColumn,
        visualAsset,
        tableCount,
        equationCount,
        linkCount,
      });
      page.cleanup();
    }
  } finally {
    await ocrSession?.terminate().catch(() => undefined);
  }

  context.onProgress({ phase: 'Reconstructing reading order', percent: 86, detail: 'Removing repeated headers and footers' });
  const ignored = repeatedMargins(pages);
  const info = metadata?.info as Record<string, unknown> | undefined;
  const title = typeof info?.Title === 'string' && info.Title.trim()
    ? info.Title.trim()
    : stemOf(file.name).replace(/-/g, ' ');
  const sections: string[] = [`# ${title}`];
  if (context.options.includeMetadata && info) {
    const author = typeof info.Author === 'string' ? info.Author.trim() : '';
    const subject = typeof info.Subject === 'string' ? info.Subject.trim() : '';
    if (author) sections.push(`**Author:** ${author}`);
    if (subject) sections.push(`**Subject:** ${subject}`);
  }
  let headingCount = 0;
  let captionCount = 0;
  for (const page of pages) {
    const body = pageLinesToMarkdown(page, ignored, context.options.dehyphenate);
    headingCount += body.headings;
    captionCount += body.captions;
    const pageParts: string[] = [];
    if (context.options.keepPageMarkers) pageParts.push(`<!-- Page ${page.pageNumber} -->`);
    if (body.markdown) pageParts.push(body.markdown);
    if (page.visualAsset) {
      pageParts.push(`> **Source visual — page ${page.pageNumber}.** A high-resolution PNG is retained for tables, graphs, diagrams and visually encoded mathematics that cannot be reconstructed safely from the text layer alone.\n\n![High-resolution source visual for page ${page.pageNumber}](assets/${page.visualAsset})`);
    }
    sections.push(pageParts.join('\n\n'));
  }

  const tableCount = pages.reduce((sum, page) => sum + page.tableCount, 0);
  const equationCount = pages.reduce((sum, page) => sum + page.equationCount, 0);
  const multiColumnPages = pages.filter((page) => page.multiColumn).length;
  const linkCount = pages.reduce((sum, page) => sum + page.linkCount, 0);
  const ocrConfidences = pages.flatMap((page) => page.ocrConfidence === undefined ? [] : [page.ocrConfidence]);
  const averageOcrConfidence = ocrConfidences.length ? Math.round(ocrConfidences.reduce((sum, value) => sum + value, 0) / ocrConfidences.length) : undefined;
  if (scannedPages) warnings.push(`${scannedPages} scanned or image-only page${scannedPages === 1 ? ' was' : 's were'} detected. OCR text should be proofread against the preserved visual layer.`);
  if (tableCount) warnings.push(`${tableCount} PDF table${tableCount === 1 ? ' was' : 's were'} reconstructed from aligned text anchors. Merged cells and border-only meaning should be checked against the retained page image.`);
  if (equationCount) warnings.push('PDF equations do not contain a universal semantic LaTeX representation. Unicode mathematics was mapped heuristically; compare important formulae with the visual layer.');
  if (multiColumnPages) warnings.push(`${multiColumnPages} multi-column page${multiColumnPages === 1 ? ' was' : 's were'} reordered geometrically. Unusual floating boxes may still need manual review.`);

  const metrics: Metric[] = [
    {
      label: 'Text', value: scannedPages ? `${documentProxy.numPages - scannedPages} native · ${scannedPages} OCR` : 'Native text',
      level: scannedPages && (averageOcrConfidence ?? 100) < 78 ? 'review' : scannedPages ? 'medium' : 'high',
      detail: scannedPages ? `Digital pages use embedded characters; image-only pages use geometry-aware local OCR${averageOcrConfidence === undefined ? '' : ` (${averageOcrConfidence}% mean confidence)`}.` : 'Characters, font signals and coordinates are read directly from the PDF text layer.',
    },
    {
      label: 'Tables', value: tableCount ? `${tableCount} detected` : 'None detected', level: tableCount ? 'medium' : 'high',
      detail: 'Tables are inferred from repeated geometric columns. Borderless or highly merged tables require visual review.',
    },
    {
      label: 'Equations', value: equationCount ? `${equationCount} candidates` : 'None detected', level: equationCount ? 'review' : 'high',
      detail: equationCount ? 'Unicode symbols are translated to LaTeX, while page snapshots preserve the authoritative appearance.' : 'No math-dense lines were detected.',
    },
    {
      label: 'Visuals', value: visualPages ? `${visualPages} pages preserved` : 'No visual layer', level: visualPages ? 'high' : 'medium',
      detail: visualPages ? 'Relevant pages are rendered at high resolution and exported losslessly as linked PNG assets.' : 'No raster images, inferred tables, equations or dense vector drawings required a visual page.',
    },
    {
      label: 'Layout', value: multiColumnPages ? `${multiColumnPages} multi-column` : `${headingCount} headings`, level: multiColumnPages ? 'medium' : 'high',
      detail: `${headingCount} heading signal${headingCount === 1 ? '' : 's'} and ${captionCount} caption${captionCount === 1 ? '' : 's'} were reconstructed from font, alignment and spacing evidence.`,
    },
    {
      label: 'Links', value: linkCount ? `${linkCount} preserved` : 'None detected', level: 'high',
      detail: linkCount ? 'External PDF link annotations are mapped onto their overlapping text spans.' : 'No external link annotations overlapped the extracted text.',
    },
  ];
  context.onProgress({ phase: 'Finalising Markdown', percent: 96, detail: `${documentProxy.numPages} pages` });
  await loadingTask.destroy();
  return {
    markdown: normalizeMarkdown(sections.filter(Boolean).join('\n\n')),
    assets,
    metrics,
    warnings,
    sourceType: 'PDF',
    pageCount: pages.length,
  };
}
