import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Asset, ConverterContext, Metric } from '../types';
import { canvasToBlob, safeAssetName, stemOf, uniqueAssetName } from '../utils/files';
import {
  dehyphenateLines,
  looksMathematical,
  markdownTable,
  normalizeMarkdown,
  unicodeMathToLatex,
} from '../utils/markdown';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const byteArrayPrototype = Uint8Array.prototype as Uint8Array & { toHex?: () => string };
if (!byteArrayPrototype.toHex) {
  Object.defineProperty(byteArrayPrototype, 'toHex', {
    configurable: true,
    value(this: Uint8Array): string {
      return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('');
    },
  });
}

const mapPrototype = Map.prototype as Map<unknown, unknown> & {
  getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown;
};
if (!mapPrototype.getOrInsertComputed) {
  Object.defineProperty(mapPrototype, 'getOrInsertComputed', {
    configurable: true,
    value(this: Map<unknown, unknown>, key: unknown, callback: (key: unknown) => unknown): unknown {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    },
  });
}

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
}

interface PdfLine {
  text: string;
  cells: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  gapAfter: number;
}

interface PageModel {
  pageNumber: number;
  lines: PdfLine[];
  scanned: boolean;
  multiColumn: boolean;
  visualAsset?: string;
  tableCount: number;
  equationCount: number;
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

function textPieces(content: PdfTextContent): TextPiece[] {
  const pieces: TextPiece[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const transform = item.transform;
    pieces.push({
      text: item.str.replace(/\s+/g, ' ').trim(),
      x: transform[4] ?? 0,
      y: transform[5] ?? 0,
      width: Math.abs(item.width),
      height: Math.max(Math.abs(transform[3] ?? 0), Math.abs(item.height), 1),
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

function largestGap(row: TextPiece[]): { gap: number; index: number } {
  let gap = 0;
  let index = -1;
  for (let cursor = 0; cursor < row.length - 1; cursor += 1) {
    const current = row[cursor];
    const next = row[cursor + 1];
    if (!current || !next) continue;
    const candidate = next.x - (current.x + current.width);
    if (candidate > gap) {
      gap = candidate;
      index = cursor;
    }
  }
  return { gap, index };
}

function orderRowsForColumns(rows: TextPiece[][], pageWidth: number): { rows: TextPiece[][]; multiColumn: boolean } {
  const splitRows = rows.map((row) => ({ row, ...largestGap(row) })).filter(({ gap, index }) => gap > pageWidth * 0.12 && index >= 0);
  if (splitRows.length < Math.max(5, rows.length * 0.22)) return { rows, multiColumn: false };

  const splitXs = splitRows.map(({ row, index }) => {
    const left = row[index];
    const right = row[index + 1];
    return ((left?.x ?? 0) + (left?.width ?? 0) + (right?.x ?? pageWidth)) / 2;
  });
  const splitX = median(splitXs);
  if (splitX < pageWidth * 0.3 || splitX > pageWidth * 0.7) return { rows, multiColumn: false };

  const columnRows = rows.filter((row) => {
    const start = row[0]?.x ?? 0;
    const end = (row.at(-1)?.x ?? 0) + (row.at(-1)?.width ?? 0);
    return start < splitX - pageWidth * 0.04 && end > splitX + pageWidth * 0.04;
  });
  const topY = Math.max(...columnRows.map((row) => row[0]?.y ?? 0));
  const bottomY = Math.min(...columnRows.map((row) => row[0]?.y ?? 0));
  const top: TextPiece[][] = [];
  const bottom: TextPiece[][] = [];
  const left: TextPiece[][] = [];
  const right: TextPiece[][] = [];

  for (const row of rows) {
    const y = row[0]?.y ?? 0;
    const rowStart = row[0]?.x ?? 0;
    const rowEnd = (row.at(-1)?.x ?? 0) + (row.at(-1)?.width ?? 0);
    if (y > topY + 2 || (rowStart < splitX && rowEnd > splitX && y >= topY - 2)) top.push(row);
    else if (y < bottomY - 2 || (rowStart < splitX && rowEnd > splitX && y <= bottomY + 2)) bottom.push(row);
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

function joinPieces(row: TextPiece[]): { text: string; cells: string[] } {
  if (!row.length) return { text: '', cells: [] };
  const typicalHeight = median(row.map((piece) => piece.height)) || 10;
  const cellGroups: TextPiece[][] = [[]];
  let text = '';
  for (let index = 0; index < row.length; index += 1) {
    const piece = row[index];
    if (!piece) continue;
    const previous = row[index - 1];
    const gap = previous ? piece.x - (previous.x + previous.width) : 0;
    if (previous && gap > typicalHeight * 1.7) cellGroups.push([]);
    cellGroups.at(-1)?.push(piece);
    const needsSpace = previous && gap > Math.max(1.5, typicalHeight * 0.14) && !/^[,.;:!?%)\]}]/.test(piece.text);
    text += `${needsSpace ? ' ' : ''}${piece.text}`;
  }
  const cells = cellGroups.map((group) => group.map((piece) => piece.text).join(' ').trim()).filter(Boolean);
  return { text: text.trim(), cells };
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
      x: first?.x ?? 0,
      y: first?.y ?? 0,
      width: last ? last.x + last.width - (first?.x ?? 0) : 0,
      height: median(row.map((piece) => piece.height)),
      gapAfter: Math.abs((first?.y ?? 0) - (next?.[0]?.y ?? 0)),
    };
  });
  return { lines, multiColumn: ordered.multiColumn };
}

function isStableTableRun(lines: PdfLine[], index: number): number {
  const first = lines[index];
  if (!first || first.cells.length < 2) return 0;
  let length = 1;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!line || line.cells.length < 2 || Math.abs(line.cells.length - first.cells.length) > 1) break;
    if (line.gapAfter > Math.max(28, line.height * 2.7)) break;
    length += 1;
  }
  return length >= 2 ? length : 0;
}

function pageLinesToMarkdown(page: PageModel, ignored: Set<string>, dehyphenate: boolean): string {
  const lines = dehyphenate
    ? dehyphenateLines(page.lines.map((line) => line.text))
    : page.lines.map((line) => line.text);
  const medianHeight = median(page.lines.map((line) => line.height).filter(Boolean)) || 10;
  const parts: string[] = [];
  let paragraph: string[] = [];
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

    const tableLength = isStableTableRun(page.lines, index);
    if (tableLength) {
      flush();
      const rows = page.lines.slice(index, index + tableLength).map((tableLine) => tableLine.cells);
      parts.push(markdownTable(rows));
      index += tableLength - 1;
      continue;
    }

    const heading = line.height > medianHeight * 1.28 && text.length < 140 && !/[.!?]$/.test(text);
    if (heading) {
      flush();
      const ratio = line.height / medianHeight;
      parts.push(`${ratio > 1.75 ? '##' : '###'} ${text}`);
      continue;
    }
    if (looksMathematical(text)) {
      flush();
      parts.push(`$$\n${unicodeMathToLatex(text)}\n$$`);
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
    paragraph.push(text);
    if (/[.!?:;]$/.test(text) || line.gapAfter > medianHeight * 1.65) flush();
  }
  flush();
  return parts.join('\n\n');
}

function repeatedMargins(pages: PageModel[]): Set<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const candidates = [...page.lines.slice(0, 2), ...page.lines.slice(-2)];
    const unique = new Set(candidates.map((line) => line.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()).filter(Boolean));
    for (const candidate of unique) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  return new Set(Array.from(counts.entries()).filter(([, count]) => count >= threshold).map(([text]) => text));
}

async function renderPage(page: PdfPage, scale = 1.6): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const canvasContext = canvas.getContext('2d', { alpha: false });
  if (!canvasContext) throw new Error('Canvas rendering is not supported in this browser.');
  await page.render({ canvas, canvasContext, viewport }).promise;
  return canvas;
}

async function ocrCanvas(canvas: HTMLCanvasElement, onProgress: (percent: number) => void): Promise<string> {
  const { createWorker, OEM } = await import('tesseract.js');
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    logger: (message) => {
      if (message.status === 'recognizing text') onProgress(Math.round((message.progress ?? 0) * 100));
    },
  });
  try {
    const recognition = await worker.recognize(canvas);
    return recognition.data.text.trim();
  } finally {
    await worker.terminate();
  }
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
    if (pathCodes.has(code)) pathCount += 1;
  }
  return pathCount > 90;
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

  for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
    const basePercent = 8 + ((pageNumber - 1) / documentProxy.numPages) * 74;
    context.onProgress({ phase: `Analysing page ${pageNumber} of ${documentProxy.numPages}`, percent: Math.round(basePercent), detail: 'Reading text geometry and layout' });
    const page = await documentProxy.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ includeMarkedContent: true });
    let pieces = textPieces(content);
    const digitalCharacters = pieces.reduce((sum, piece) => sum + piece.text.length, 0);
    const scanned = digitalCharacters < 32;
    let canvas: HTMLCanvasElement | undefined;

    if (scanned) {
      scannedPages += 1;
      if (context.options.runOcr) {
        canvas = await renderPage(page, 2);
        context.onProgress({ phase: `OCR page ${pageNumber}`, percent: Math.round(basePercent + 2), detail: 'Language model runs locally in this tab' });
        const text = await ocrCanvas(canvas, (progress) => {
          context.onProgress({ phase: `OCR page ${pageNumber}`, percent: Math.min(88, Math.round(basePercent + progress * 0.08)), detail: `${progress}% recognised` });
        });
        pieces = text.split(/\r?\n/).filter(Boolean).map((line, index) => ({
          text: line.trim(), x: 0, y: 1000 - index * 14, width: line.length * 7, height: 11,
        }));
      } else {
        warnings.push(`Page ${pageNumber} appears scanned and OCR was disabled.`);
      }
    }

    const geometric = linesFromPieces(pieces, viewport.width);
    const visual = context.options.preserveVisualPages && (scanned || await hasVisualOperators(page));
    let visualAsset: string | undefined;
    if (visual) {
      visualPages += 1;
      canvas ??= await renderPage(page);
      const name = uniqueAssetName(safeAssetName(`page-${pageNumber}-visual.png`), assets);
      assets.push({ name, blob: await canvasToBlob(canvas), kind: 'image', source: `PDF page ${pageNumber}` });
      visualAsset = name;
    }
    const equationCount = geometric.lines.filter((line) => looksMathematical(line.text)).length;
    let tableCount = 0;
    for (let index = 0; index < geometric.lines.length; index += 1) {
      const length = isStableTableRun(geometric.lines, index);
      if (length) {
        tableCount += 1;
        index += length - 1;
      }
    }
    pages.push({ pageNumber, lines: geometric.lines, scanned, multiColumn: geometric.multiColumn, visualAsset, tableCount, equationCount });
    page.cleanup();
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
  for (const page of pages) {
    const body = pageLinesToMarkdown(page, ignored, context.options.dehyphenate);
    const pageParts: string[] = [];
    if (context.options.keepPageMarkers) pageParts.push(`<!-- Page ${page.pageNumber} -->`);
    if (body) pageParts.push(body);
    if (page.visualAsset) {
      pageParts.push(`> **Original visual layer — page ${page.pageNumber}.** This snapshot preserves graphs, diagrams and visually encoded mathematics that cannot be represented reliably by text extraction alone.\n\n![Original visual layer for page ${page.pageNumber}](assets/${page.visualAsset})`);
    }
    sections.push(pageParts.join('\n\n'));
  }

  const tableCount = pages.reduce((sum, page) => sum + page.tableCount, 0);
  const equationCount = pages.reduce((sum, page) => sum + page.equationCount, 0);
  const multiColumnPages = pages.filter((page) => page.multiColumn).length;
  if (scannedPages) warnings.push(`${scannedPages} scanned or image-only page${scannedPages === 1 ? ' was' : 's were'} detected. OCR text should be proofread against the preserved visual layer.`);
  if (equationCount) warnings.push('PDF equations do not contain a universal semantic LaTeX representation. Unicode mathematics was mapped heuristically; compare important formulae with the visual layer.');
  if (multiColumnPages) warnings.push(`${multiColumnPages} multi-column page${multiColumnPages === 1 ? ' was' : 's were'} reordered geometrically. Unusual floating boxes may still need manual review.`);

  const metrics: Metric[] = [
    {
      label: 'Text', value: scannedPages ? `${documentProxy.numPages - scannedPages} native · ${scannedPages} OCR` : 'Native text',
      level: scannedPages ? 'medium' : 'high',
      detail: scannedPages ? 'Digital pages use embedded characters; image-only pages use local OCR.' : 'Characters and coordinates are read directly from the PDF text layer.',
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
      detail: visualPages ? 'Pages containing raster images or dense vector graphics are exported losslessly as linked PNG assets.' : 'No raster images or dense vector drawings were detected.',
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
