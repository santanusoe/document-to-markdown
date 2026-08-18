import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { ConversionResult } from '../types';
import { packageResult } from '../utils/files';

function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('complete conversion packages', () => {
  it('keeps Markdown, figures, and placement instructions together', async () => {
    const result: ConversionResult = {
      id: 'result-1',
      sourceName: 'research.pdf',
      sourceType: 'PDF',
      markdown: '# Research\n\n![Figure 1](assets/page-1-figure-1.png)\n',
      assets: [{ name: 'page-1-figure-1.png', blob: new Blob(['png'], { type: 'image/png' }), kind: 'image' }],
      metrics: [],
      warnings: [],
      elapsedMs: 12,
      pageCount: 1,
      wordCount: 1,
    };
    const zip = await JSZip.loadAsync(await blobBytes(await packageResult(result)));
    expect(zip.file('research/research.md')).not.toBeNull();
    expect(zip.file('research/assets/page-1-figure-1.png')).not.toBeNull();
    expect(await zip.file('research/README.txt')?.async('string')).toContain('from the assets folder');
    expect(zip.file('research/conversion-report.json')).not.toBeNull();
  });
});
