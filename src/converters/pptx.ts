import JSZip from 'jszip';
import type { Asset, ConverterContext, Metric } from '../types';
import { safeAssetName, uniqueAssetName } from '../utils/files';
import { markdownTable, normalizeMarkdown } from '../utils/markdown';
import { ommlToLatex } from '../utils/omml';
import { extractCharts } from '../utils/openxml';
import { attrLocal, firstLocal, localElements, naturalSort, parseXml } from '../utils/xml';

interface PptxConversion {
  markdown: string;
  assets: Asset[];
  metrics: Metric[];
  warnings: string[];
  sourceType: string;
  pageCount: number;
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf',
};

function normalizeZipPath(base: string, target: string): string {
  const parts = `${base}/${target}`.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') normalized.pop();
    else normalized.push(part);
  }
  return normalized.join('/');
}

function relationships(document: XMLDocument): Map<string, string> {
  const map = new Map<string, string>();
  for (const relationship of localElements(document, 'Relationship')) {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (id && target) map.set(id, target);
  }
  return map;
}

function runText(run: Element): string {
  const text = localElements(run, 't').map((node) => node.textContent ?? '').join('');
  const properties = firstLocal(run, 'rPr');
  const bold = properties && ['1', 'true'].includes(attrLocal(properties, 'b') ?? '');
  const italic = properties && ['1', 'true'].includes(attrLocal(properties, 'i') ?? '');
  if (bold && italic) return `***${text}***`;
  if (bold) return `**${text}**`;
  if (italic) return `*${text}*`;
  return text;
}

function paragraphText(paragraph: Element): string {
  const runs = localElements(paragraph, 'r').map(runText);
  const fields = localElements(paragraph, 'fld').map((field) => localElements(field, 't').map((node) => node.textContent ?? '').join(''));
  const equations = localElements(paragraph, 'oMath').map((equation) => `$${ommlToLatex(equation)}$`);
  const text = [...runs, ...fields, ...equations].join('').trim();
  const properties = firstLocal(paragraph, 'pPr');
  const level = Number(attrLocal(properties ?? paragraph, 'lvl') ?? 0);
  const isBullet = Boolean(properties && (firstLocal(properties, 'buChar') || firstLocal(properties, 'buAutoNum')));
  return isBullet ? `${'  '.repeat(level)}- ${text}` : text;
}

function shapePosition(shape: Element): [number, number] {
  const offset = firstLocal(shape, 'off');
  return [Number(attrLocal(offset ?? shape, 'y') ?? 0), Number(attrLocal(offset ?? shape, 'x') ?? 0)];
}

function tableFromFrame(frame: Element): string {
  const rows = localElements(frame, 'tr').map((row) =>
    localElements(row, 'tc').map((cell) =>
      localElements(cell, 'p').map(paragraphText).filter(Boolean).join('<br>'),
    ),
  );
  return rows.length ? markdownTable(rows) : '';
}

function slideTitle(document: XMLDocument): string {
  const titleShape = localElements(document, 'sp').find((shape) => {
    const placeholder = firstLocal(shape, 'ph');
    return ['title', 'ctrTitle'].includes(attrLocal(placeholder ?? shape, 'type') ?? '');
  });
  return titleShape
    ? localElements(titleShape, 'p').map(paragraphText).filter(Boolean).join(' ').trim()
    : '';
}

async function mediaAsset(
  zip: JSZip,
  targetPath: string,
  assets: Asset[],
  cache: Map<string, string>,
): Promise<string | undefined> {
  const existing = cache.get(targetPath);
  if (existing) return existing;
  const entry = zip.file(targetPath);
  if (!entry) return undefined;
  const extension = targetPath.split('.').pop()?.toLowerCase() ?? 'bin';
  const name = uniqueAssetName(safeAssetName(targetPath), assets);
  assets.push({
    name,
    blob: new Blob([await entry.async('uint8array')], { type: MEDIA_TYPES[extension] ?? 'application/octet-stream' }),
    kind: MEDIA_TYPES[extension] ? 'image' : 'attachment',
    source: targetPath,
  });
  cache.set(targetPath, name);
  return name;
}

async function speakerNotes(zip: JSZip, slideNumber: number): Promise<string> {
  const path = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
  const xml = await zip.file(path)?.async('string');
  if (!xml) return '';
  const document = parseXml(xml);
  const paragraphs = localElements(document, 'p')
    .map(paragraphText)
    .filter((text) => text && !/^\d+$/.test(text));
  return paragraphs.length ? `#### Speaker notes\n\n${paragraphs.join('\n\n')}` : '';
}

export async function convertPptx(
  file: File,
  buffer: ArrayBuffer,
  context: ConverterContext,
): Promise<PptxConversion> {
  context.onProgress({ phase: 'Opening slide deck', percent: 12, detail: 'Reading PresentationML package' });
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = naturalSort(Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path)));
  if (!slidePaths.length) throw new Error('This file is not a valid PPTX deck: no slides were found.');
  const assets: Asset[] = [];
  const mediaCache = new Map<string, string>();
  const sections: string[] = [`# ${file.name.replace(/\.[^.]+$/, '')}`];
  let equationCount = 0;
  let tableCount = 0;
  let noteCount = 0;

  for (let index = 0; index < slidePaths.length; index += 1) {
    const slidePath = slidePaths[index];
    if (!slidePath) continue;
    context.onProgress({ phase: `Converting slide ${index + 1} of ${slidePaths.length}`, percent: 18 + Math.round((index / slidePaths.length) * 56), detail: 'Ordering text, tables, equations and media' });
    const xml = await zip.file(slidePath)?.async('string');
    if (!xml) continue;
    const document = parseXml(xml);
    const relPath = `ppt/slides/_rels/slide${index + 1}.xml.rels`;
    const relXml = await zip.file(relPath)?.async('string');
    const rels = relXml ? relationships(parseXml(relXml)) : new Map<string, string>();
    const title = slideTitle(document) || `Slide ${index + 1}`;
    const slideParts: string[] = [`## ${title}`];
    const contentNodes = [...localElements(document, 'sp'), ...localElements(document, 'graphicFrame'), ...localElements(document, 'pic')]
      .sort((left, right) => {
        const [leftY, leftX] = shapePosition(left);
        const [rightY, rightX] = shapePosition(right);
        return leftY - rightY || leftX - rightX;
      });

    for (const node of contentNodes) {
      if (node.localName === 'sp') {
        const paragraphs = localElements(node, 'p').map(paragraphText).filter(Boolean);
        const joined = paragraphs.join('\n\n').trim();
        if (joined && joined !== title) slideParts.push(joined);
        equationCount += localElements(node, 'oMath').length;
      } else if (node.localName === 'graphicFrame') {
        const table = tableFromFrame(node);
        if (table) {
          tableCount += 1;
          slideParts.push(table);
        }
      } else if (node.localName === 'pic') {
        const blip = firstLocal(node, 'blip');
        const relationshipId = blip ? attrLocal(blip, 'embed') : undefined;
        const target = relationshipId ? rels.get(relationshipId) : undefined;
        if (!target) continue;
        const targetPath = normalizeZipPath('ppt/slides', target);
        const assetName = await mediaAsset(zip, targetPath, assets, mediaCache);
        if (!assetName) continue;
        const properties = firstLocal(node, 'cNvPr');
        const alt = attrLocal(properties ?? node, 'descr') || attrLocal(properties ?? node, 'name') || `Slide ${index + 1} image`;
        slideParts.push(`![${alt.replace(/[[\]]/g, '')}](assets/${assetName})`);
      }
    }

    const notes = await speakerNotes(zip, index + 1);
    if (notes) {
      noteCount += 1;
      slideParts.push(notes);
    }
    sections.push(slideParts.join('\n\n'));
  }

  context.onProgress({ phase: 'Recovering chart data', percent: 80, detail: 'Reading cached categories and series' });
  const charts = await extractCharts(zip, 'ppt');
  sections.push(charts.markdown);
  const warnings = [...charts.warnings];
  if (charts.count) warnings.push('PowerPoint chart visuals are proprietary drawing objects. Their cached source data are preserved as Markdown tables, but exact styling is not reproducible in Markdown.');

  const metrics: Metric[] = [
    { label: 'Slides', value: `${slidePaths.length}`, level: 'high', detail: 'Slide order and shape coordinates are read directly from PresentationML.' },
    { label: 'Tables', value: `${tableCount} preserved`, level: 'high', detail: 'Native PowerPoint table rows and cells are converted structurally.' },
    { label: 'Equations', value: equationCount ? `${equationCount} → LaTeX` : 'None found', level: equationCount ? 'high' : 'medium', detail: 'Native Office Math objects are converted to LaTeX; ordinary text remains ordinary text.' },
    { label: 'Visuals', value: `${assets.length} media · ${charts.count} charts`, level: charts.count ? 'medium' : 'high', detail: `Embedded images are exported. Speaker notes were recovered from ${noteCount} slide${noteCount === 1 ? '' : 's'}.` },
  ];
  context.onProgress({ phase: 'Finalising Markdown', percent: 94, detail: `${slidePaths.length} slides` });
  return {
    markdown: normalizeMarkdown(sections.filter(Boolean).join('\n\n')),
    assets,
    metrics,
    warnings,
    sourceType: 'PPTX',
    pageCount: slidePaths.length,
  };
}
