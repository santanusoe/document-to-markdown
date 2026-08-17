import JSZip from 'jszip';
import type { Asset, ConverterContext, Metric } from '../types';
import { safeAssetName, uniqueAssetName } from '../utils/files';
import { htmlToMarkdown, markdownTable, normalizeMarkdown } from '../utils/markdown';
import { attrLocal, firstLocal, localElements, parseXml } from '../utils/xml';

interface ArchiveConversion {
  markdown: string;
  assets: Asset[];
  metrics: Metric[];
  warnings: string[];
  sourceType: string;
  pageCount?: number;
}

function normalizePath(base: string, target: string): string {
  const parts = `${base}/${target}`.split('/');
  const output: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') output.pop();
    else output.push(part);
  }
  return output.join('/');
}

function mimeFromPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
  } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}

async function addAsset(zip: JSZip, path: string, assets: Asset[]): Promise<string | undefined> {
  const entry = zip.file(path);
  if (!entry) return undefined;
  const name = uniqueAssetName(safeAssetName(path), assets);
  const mime = mimeFromPath(path);
  assets.push({ name, blob: new Blob([await entry.async('uint8array')], { type: mime }), kind: mime.startsWith('image/') ? 'image' : 'attachment', source: path });
  return name;
}

function odtTable(table: Element): string {
  const rows = localElements(table, 'table-row').map((row) =>
    Array.from(row.children)
      .filter((cell) => ['table-cell', 'covered-table-cell'].includes(cell.localName))
      .map((cell) => localElements(cell, 'p').map((paragraph) => paragraph.textContent?.trim() ?? '').filter(Boolean).join('<br>')),
  );
  return markdownTable(rows);
}

export async function convertOdt(
  file: File,
  buffer: ArrayBuffer,
  context: ConverterContext,
): Promise<ArchiveConversion> {
  context.onProgress({ phase: 'Opening OpenDocument', percent: 18, detail: 'Reading content.xml and embedded assets' });
  const zip = await JSZip.loadAsync(buffer);
  const content = await zip.file('content.xml')?.async('string');
  if (!content) throw new Error('This file is not a valid OpenDocument text package.');
  const document = parseXml(content);
  const body = firstLocal(document, 'text') ?? document.documentElement;
  const assets: Asset[] = [];
  const parts: string[] = [`# ${file.name.replace(/\.[^.]+$/, '')}`];
  let tableCount = 0;
  let equationCount = 0;

  for (const node of Array.from(body.children)) {
    if (node.localName === 'h') {
      const level = Math.min(6, Math.max(1, Number(attrLocal(node, 'outline-level') ?? 1)));
      parts.push(`${'#'.repeat(level + 1)} ${node.textContent?.trim() ?? ''}`);
    } else if (node.localName === 'p') {
      const text = node.textContent?.trim();
      if (text) parts.push(text);
    } else if (node.localName === 'list') {
      const items = localElements(node, 'list-item').map((item) => `- ${item.textContent?.trim() ?? ''}`).filter((item) => item.length > 2);
      if (items.length) parts.push(items.join('\n'));
    } else if (node.localName === 'table') {
      tableCount += 1;
      parts.push(odtTable(node));
    }
  }

  for (const image of localElements(document, 'image')) {
    const href = attrLocal(image, 'href');
    if (!href) continue;
    const name = await addAsset(zip, href.replace(/^\.\//, ''), assets);
    if (name) parts.push(`![Embedded image](assets/${name})`);
  }
  const objectPaths = Object.keys(zip.files).filter((path) => /Object[^/]*\/content\.xml$/i.test(path));
  for (const path of objectPaths) {
    const mathXml = await zip.file(path)?.async('string');
    if (!mathXml || !/<(?:\w+:)?math[\s>]/i.test(mathXml)) continue;
    equationCount += 1;
    const math = mathXml.match(/<(?:\w+:)?math[\s\S]*<\/(?:\w+:)?math>/i)?.[0];
    if (math) parts.push(`<!-- MathML equation preserved from ${path} -->\n${math}`);
  }

  const metrics: Metric[] = [
    { label: 'Text', value: 'Source XML', level: 'high', detail: 'Text is read directly from the OpenDocument XML package.' },
    { label: 'Tables', value: `${tableCount} preserved`, level: 'high', detail: 'Native table rows and cells are converted deterministically.' },
    { label: 'Equations', value: equationCount ? `${equationCount} MathML` : 'None found', level: equationCount ? 'high' : 'medium', detail: 'Embedded MathML is retained verbatim, avoiding lossy image recognition.' },
    { label: 'Visuals', value: `${assets.length} exported`, level: 'high', detail: 'Referenced package images are extracted into the assets directory.' },
  ];
  return { markdown: normalizeMarkdown(parts.filter(Boolean).join('\n\n')), assets, metrics, warnings: [], sourceType: 'ODT' };
}

export async function convertEpub(
  file: File,
  buffer: ArrayBuffer,
  context: ConverterContext,
): Promise<ArchiveConversion> {
  context.onProgress({ phase: 'Opening EPUB', percent: 16, detail: 'Resolving manifest and reading order' });
  const zip = await JSZip.loadAsync(buffer);
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('This file is not a valid EPUB package.');
  const container = parseXml(containerXml);
  const rootfile = firstLocal(container, 'rootfile');
  const packagePath = rootfile ? attrLocal(rootfile, 'full-path') : undefined;
  if (!packagePath) throw new Error('The EPUB package does not declare a root content document.');
  const packageXml = await zip.file(packagePath)?.async('string');
  if (!packageXml) throw new Error('The EPUB package document is missing.');
  const packageDocument = parseXml(packageXml);
  const base = packagePath.includes('/') ? packagePath.slice(0, packagePath.lastIndexOf('/')) : '';
  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const item of localElements(packageDocument, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, { href, mediaType: item.getAttribute('media-type') ?? '' });
  }
  const spine = localElements(packageDocument, 'itemref').map((item) => item.getAttribute('idref') ?? '').filter(Boolean);
  const assets: Asset[] = [];
  const assetMap = new Map<string, string>();
  for (const entry of manifest.values()) {
    if (!entry.mediaType.startsWith('image/')) continue;
    const path = normalizePath(base, entry.href);
    const name = await addAsset(zip, path, assets);
    if (name) assetMap.set(path, name);
  }
  const sections: string[] = [`# ${file.name.replace(/\.[^.]+$/, '')}`];
  for (let index = 0; index < spine.length; index += 1) {
    const entry = manifest.get(spine[index] ?? '');
    if (!entry) continue;
    context.onProgress({ phase: `Converting chapter ${index + 1} of ${spine.length}`, percent: 22 + Math.round((index / Math.max(1, spine.length)) * 64), detail: entry.href });
    const path = normalizePath(base, entry.href);
    const html = await zip.file(path)?.async('string');
    if (!html) continue;
    const chapter = new DOMParser().parseFromString(html, 'text/html');
    chapter.querySelectorAll('script, style, nav[epub\\:type="landmarks"]').forEach((node) => node.remove());
    for (const image of Array.from(chapter.images)) {
      const source = image.getAttribute('src');
      if (!source) continue;
      const absolute = normalizePath(path.slice(0, path.lastIndexOf('/')), source.split('#')[0] ?? source);
      const assetName = assetMap.get(absolute);
      if (assetName) image.setAttribute('src', `assets/${assetName}`);
    }
    const markdown = htmlToMarkdown(chapter.body.innerHTML);
    if (markdown.trim()) sections.push(markdown);
  }
  const metrics: Metric[] = [
    { label: 'Chapters', value: `${spine.length}`, level: 'high', detail: 'The EPUB spine defines the authoritative reading order.' },
    { label: 'Text', value: 'Semantic XHTML', level: 'high', detail: 'Headings, emphasis, links, lists and quotations are converted from source markup.' },
    { label: 'Tables', value: 'Semantic', level: 'high', detail: 'HTML table structure is preserved through GFM or embedded HTML.' },
    { label: 'Visuals', value: `${assets.length} exported`, level: 'high', detail: 'Manifest images are extracted and chapter references are rewritten locally.' },
  ];
  return { markdown: normalizeMarkdown(sections.join('\n\n')), assets, metrics, warnings: [], sourceType: 'EPUB', pageCount: spine.length };
}
