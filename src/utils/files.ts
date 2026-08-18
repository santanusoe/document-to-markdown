import type { Asset, ConversionResult } from '../types';

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot < 0 ? name : name.slice(0, dot))
    .normalize('NFKD')
    .replace(/[^\w\-. ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'document';
}

export function safeAssetName(name: string, fallback = 'asset'): string {
  const cleaned = name
    .split(/[\\/]/)
    .pop()
    ?.normalize('NFKD')
    .replace(/[^\w.()-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
}

export function uniqueAssetName(desired: string, assets: Asset[]): string {
  const used = new Set(assets.map((asset) => asset.name.toLowerCase()));
  if (!used.has(desired.toLowerCase())) return desired;
  const dot = desired.lastIndexOf('.');
  const base = dot >= 0 ? desired.slice(0, dot) : desired;
  const ext = dot >= 0 ? desired.slice(dot) : '';
  let index = 2;
  while (used.has(`${base}-${index}${ext}`.toLowerCase())) index += 1;
  return `${base}-${index}${ext}`;
}

export function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode the rendered page.'));
    }, type);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function packageResult(result: ConversionResult): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const folder = zip.folder(stemOf(result.sourceName));
  if (!folder) throw new Error('Could not create the output package.');
  folder.file(`${stemOf(result.sourceName)}.md`, result.markdown);
  for (const asset of result.assets) folder.file(`assets/${asset.name}`, asset.blob);
  if (result.assets.length) {
    folder.file(
      'README.txt',
      `Open ${stemOf(result.sourceName)}.md without moving it away from the assets folder.\n\nThe relative image links in the Markdown file resolve to ./assets/. GitHub, VS Code, Obsidian, Typora, and other GFM-compatible renderers will then display the preserved figures.\n`,
    );
  }
  folder.file(
    'conversion-report.json',
    JSON.stringify(
      {
        source: result.sourceName,
        sourceType: result.sourceType,
        generatedAt: new Date().toISOString(),
        elapsedMs: result.elapsedMs,
        words: result.wordCount,
        pages: result.pageCount,
        metrics: result.metrics,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function packageAll(results: ConversionResult[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const usedFolders = new Set<string>();
  for (const result of results) {
    const base = stemOf(result.sourceName);
    let folderName = base;
    let suffix = 2;
    while (usedFolders.has(folderName.toLowerCase())) {
      folderName = `${base}-${suffix}`;
      suffix += 1;
    }
    usedFolders.add(folderName.toLowerCase());
    const folder = zip.folder(folderName);
    if (!folder) continue;
    folder.file(`${stemOf(result.sourceName)}.md`, result.markdown);
    for (const asset of result.assets) folder.file(`assets/${asset.name}`, asset.blob);
    if (result.assets.length) {
      folder.file('README.txt', `Keep ${stemOf(result.sourceName)}.md beside the assets folder so that its figure links remain valid.\n`);
    }
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
