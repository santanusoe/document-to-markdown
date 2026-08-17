import JSZip from 'jszip';
import * as mammoth from 'mammoth/mammoth.browser';
import type { Asset, ConverterContext, Metric } from '../types';
import { base64ToBlob, safeAssetName, uniqueAssetName } from '../utils/files';
import { htmlToMarkdown, normalizeMarkdown } from '../utils/markdown';
import { tokenizeOmml } from '../utils/omml';
import { extractCharts } from '../utils/openxml';
import { firstLocal, parseXml, textOf } from '../utils/xml';

interface MammothImage {
  contentType: string;
  read(encoding: 'base64'): Promise<string>;
}

interface DocxConversion {
  markdown: string;
  assets: Asset[];
  metrics: Metric[];
  warnings: string[];
  sourceType: string;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
  'image/webp': 'webp',
};

function metadataSection(coreXml: string | undefined): string {
  if (!coreXml) return '';
  try {
    const document = parseXml(coreXml);
    const fields: Array<[string, string]> = [
      ['Title', firstLocal(document, 'title')?.textContent?.trim() ?? ''],
      ['Author', firstLocal(document, 'creator')?.textContent?.trim() ?? ''],
      ['Subject', firstLocal(document, 'subject')?.textContent?.trim() ?? ''],
      ['Created', firstLocal(document, 'created')?.textContent?.trim() ?? ''],
      ['Modified', firstLocal(document, 'modified')?.textContent?.trim() ?? ''],
    ];
    const present = fields.filter(([, value]) => value);
    if (!present.length) return '';
    return ['---', ...present.map(([key, value]) => `${key.toLowerCase()}: ${JSON.stringify(value)}`), '---'].join('\n');
  } catch {
    return '';
  }
}

function equationTokenCount(documentXml: string): number {
  try {
    const document = parseXml(documentXml);
    return document.getElementsByTagNameNS('*', 'oMath').length;
  } catch {
    return 0;
  }
}

export async function convertDocx(
  file: File,
  buffer: ArrayBuffer,
  context: ConverterContext,
): Promise<DocxConversion> {
  context.onProgress({ phase: 'Opening DOCX package', percent: 12, detail: 'Reading OpenXML parts' });
  const originalZip = await JSZip.loadAsync(buffer);
  const documentEntry = originalZip.file('word/document.xml');
  if (!documentEntry) throw new Error('This file is not a valid DOCX package: word/document.xml is missing.');
  const documentXml = await documentEntry.async('string');
  const equationCount = equationTokenCount(documentXml);

  context.onProgress({ phase: 'Recovering equations', percent: 24, detail: `${equationCount} Office Math object${equationCount === 1 ? '' : 's'} found` });
  const workingZip = await JSZip.loadAsync(buffer);
  const xmlDocument = parseXml(documentXml);
  const mathTokens = tokenizeOmml(xmlDocument);
  workingZip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDocument));
  const patchedBuffer = await workingZip.generateAsync({ type: 'arraybuffer' });

  const assets: Asset[] = [];
  let imageIndex = 0;
  context.onProgress({ phase: 'Converting document structure', percent: 42, detail: 'Headings, lists, links, tables, notes and images' });
  const conversion = await mammoth.convertToHtml(
    { arrayBuffer: patchedBuffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => p.subtitle:fresh",
        "p[style-name='Abstract'] => blockquote.abstract:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Caption'] => p.caption:fresh",
      ],
      includeDefaultStyleMap: true,
      convertImage: mammoth.images.imgElement(async (image: MammothImage) => {
        imageIndex += 1;
        const extension = MIME_EXTENSIONS[image.contentType] ?? 'bin';
        const name = uniqueAssetName(safeAssetName(`figure-${imageIndex}.${extension}`), assets);
        assets.push({
          name,
          blob: base64ToBlob(await image.read('base64'), image.contentType),
          kind: 'image',
          source: 'DOCX embedded media',
        });
        return { src: `assets/${name}` };
      }),
    },
  );

  context.onProgress({ phase: 'Extracting chart data', percent: 68, detail: 'Recovering cached series and categories' });
  const chartExtraction = await extractCharts(originalZip, 'word');
  let markdown = htmlToMarkdown(conversion.value);
  for (const token of mathTokens) markdown = markdown.replaceAll(token.token, token.markdown);

  const coreXml = context.options.includeMetadata
    ? await originalZip.file('docProps/core.xml')?.async('string')
    : undefined;
  const frontMatter = metadataSection(coreXml);
  markdown = normalizeMarkdown(
    [frontMatter, markdown, chartExtraction.markdown].filter(Boolean).join('\n\n'),
  );

  const warnings = [
    ...conversion.messages.map((message) => message.message),
    ...chartExtraction.warnings,
  ];
  const hasTables = /<table|\|\s*---/i.test(`${conversion.value}\n${markdown}`);
  const metrics: Metric[] = [
    {
      label: 'Text', value: 'Source XML', level: 'high',
      detail: 'Text is read from WordprocessingML, so digital characters are not re-OCRed.',
    },
    {
      label: 'Tables', value: hasTables ? 'Structured' : 'None found', level: 'high',
      detail: 'Rows, cells and simple merges are retained; complex spans remain as semantic HTML inside Markdown.',
    },
    {
      label: 'Equations', value: equationCount ? `${equationCount} → LaTeX` : 'None found', level: equationCount ? 'high' : 'medium',
      detail: equationCount
        ? 'Native Office Math (OMML) is converted structurally to LaTeX rather than guessed from pixels.'
        : 'No native Office Math objects were present.',
    },
    {
      label: 'Visuals', value: `${assets.length} image${assets.length === 1 ? '' : 's'}`, level: 'high',
      detail: `${assets.length} embedded image${assets.length === 1 ? ' was' : 's were'} exported; ${chartExtraction.count} chart definition${chartExtraction.count === 1 ? '' : 's'} inspected.`,
    },
  ];

  context.onProgress({ phase: 'Finalising Markdown', percent: 92, detail: file.name });
  return { markdown, assets, metrics, warnings, sourceType: 'DOCX' };
}

export function extractDocxTitle(documentXml: string): string {
  try {
    const document = parseXml(documentXml);
    return textOf(document, 't').trim().slice(0, 120);
  } catch {
    return '';
  }
}
