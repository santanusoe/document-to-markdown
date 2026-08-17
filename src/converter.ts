import type { ConversionOptions, ConversionResult, ConverterContext, ProgressCallback } from './types';
import { extensionOf } from './utils/files';
import { normalizeMarkdown, wordCount } from './utils/markdown';

export const ACCEPTED_EXTENSIONS = [
  'pdf', 'docx', 'pptx', 'xlsx', 'xls', 'xlsb', 'ods', 'odt', 'epub',
  'csv', 'tsv', 'html', 'htm', 'md', 'markdown', 'txt', 'rtf', 'tex', 'latex',
  'json', 'xml', 'svg', 'ipynb', 'yaml', 'yml', 'js', 'ts', 'py', 'java', 'c',
  'cpp', 'rs', 'go', 'css', 'scss', 'sh', 'eml', 'log', 'png', 'jpg', 'jpeg',
  'gif', 'webp', 'bmp', 'tif', 'tiff', 'pages', 'key', 'numbers',
] as const;

const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls', 'xlsb', 'ods']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff']);
const TEXT_EXTENSIONS = new Set([
  'csv', 'tsv', 'html', 'htm', 'md', 'markdown', 'txt', 'rtf', 'tex', 'latex',
  'json', 'xml', 'svg', 'ipynb', 'yaml', 'yml', 'js', 'ts', 'py', 'java', 'c',
  'cpp', 'rs', 'go', 'css', 'scss', 'sh', 'eml', 'log',
]);

type CoreConversion = Omit<ConversionResult, 'id' | 'sourceName' | 'elapsedMs' | 'wordCount'>;

async function zipType(buffer: ArrayBuffer): Promise<string | undefined> {
  try {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const paths = new Set(Object.keys(zip.files));
    if (paths.has('word/document.xml')) return 'docx';
    if (Array.from(paths).some((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))) return 'pptx';
    if (paths.has('xl/workbook.xml')) return 'xlsx';
    if (paths.has('META-INF/container.xml')) return 'epub';
    if (paths.has('content.xml') && (await zip.file('mimetype')?.async('string'))?.includes('opendocument')) return 'odt';
    if (paths.has('QuickLook/Preview.pdf')) return 'apple-preview';
    return undefined;
  } catch {
    return undefined;
  }
}

async function convertApplePreview(
  file: File,
  buffer: ArrayBuffer,
  context: ConverterContext,
): Promise<CoreConversion> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const preview = await zip.file('QuickLook/Preview.pdf')?.async('arraybuffer');
  if (!preview) throw new Error('This Apple document does not contain a Quick Look PDF preview. Export it to PDF from Pages, Keynote, or Numbers and try again.');
  const previewFile = new File([preview], `${file.name.replace(/\.[^.]+$/, '')}.pdf`, { type: 'application/pdf' });
  const { convertPdf } = await import('./converters/pdf');
  const result = await convertPdf(previewFile, preview, context);
  result.warnings.push(`Converted the embedded Quick Look preview from ${file.name}. Native Apple editing objects are not exposed to web browsers.`);
  return { ...result, sourceType: `${extensionOf(file.name).toUpperCase()} preview` };
}

function pdfSignature(buffer: ArrayBuffer): boolean {
  const header = new TextDecoder('ascii').decode(new Uint8Array(buffer.slice(0, 5)));
  return header === '%PDF-';
}

export async function convertFile(
  file: File,
  options: ConversionOptions,
  onProgress: ProgressCallback,
): Promise<ConversionResult> {
  const started = performance.now();
  onProgress({ phase: 'Reading file', percent: 2, detail: `${(file.size / 1_048_576).toFixed(2)} MB · stays on this device` });
  const buffer = await file.arrayBuffer();
  let extension = extensionOf(file.name);
  const context: ConverterContext = { options, onProgress };
  let conversion: CoreConversion;

  if (extension === 'doc' || extension === 'ppt') {
    throw new Error(`Legacy .${extension} files do not expose a safe browser-native document model. Open the file in Microsoft Office or LibreOffice, save it as .${extension}x, and retry.`);
  }
  if (extension === 'pdf' || pdfSignature(buffer)) {
    conversion = await (await import('./converters/pdf')).convertPdf(file, buffer, context);
  } else if (extension === 'docx') {
    conversion = await (await import('./converters/docx')).convertDocx(file, buffer, context);
  } else if (extension === 'pptx') {
    conversion = await (await import('./converters/pptx')).convertPptx(file, buffer, context);
  } else if (SPREADSHEET_EXTENSIONS.has(extension)) {
    conversion = await (await import('./converters/spreadsheet')).convertSpreadsheet(file, buffer, context);
  } else if (extension === 'odt') {
    conversion = await (await import('./converters/archive')).convertOdt(file, buffer, context);
  } else if (extension === 'epub') {
    conversion = await (await import('./converters/archive')).convertEpub(file, buffer, context);
  } else if (IMAGE_EXTENSIONS.has(extension) || file.type.startsWith('image/')) {
    conversion = await (await import('./converters/image')).convertImage(file, buffer, context);
  } else if (['pages', 'key', 'numbers'].includes(extension)) {
    conversion = await convertApplePreview(file, buffer, context);
  } else if (TEXT_EXTENSIONS.has(extension) || file.type.startsWith('text/')) {
    conversion = { ...(await import('./converters/text')).convertTextLike(file, buffer, options), assets: [] };
  } else {
    onProgress({ phase: 'Identifying package', percent: 10, detail: 'Inspecting internal structure instead of trusting the extension' });
    extension = await zipType(buffer) ?? extension;
    if (extension === 'docx') conversion = await (await import('./converters/docx')).convertDocx(file, buffer, context);
    else if (extension === 'pptx') conversion = await (await import('./converters/pptx')).convertPptx(file, buffer, context);
    else if (extension === 'xlsx') conversion = await (await import('./converters/spreadsheet')).convertSpreadsheet(file, buffer, context);
    else if (extension === 'odt') conversion = await (await import('./converters/archive')).convertOdt(file, buffer, context);
    else if (extension === 'epub') conversion = await (await import('./converters/archive')).convertEpub(file, buffer, context);
    else if (extension === 'apple-preview') conversion = await convertApplePreview(file, buffer, context);
    else conversion = { ...(await import('./converters/text')).convertTextLike(file, buffer, options), assets: [] };
  }

  onProgress({ phase: 'Complete', percent: 100, detail: 'Ready to inspect and download' });
  const markdown = normalizeMarkdown(conversion.markdown);
  return {
    ...conversion,
    id: crypto.randomUUID(),
    sourceName: file.name,
    markdown,
    elapsedMs: Math.round(performance.now() - started),
    wordCount: wordCount(markdown),
  };
}
