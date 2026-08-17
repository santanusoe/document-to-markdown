import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { DEFAULT_OPTIONS, type ConverterContext } from '../types';

class TestDOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(_values?: string | number[]) {}
  multiplySelf(): this { return this; }
  preMultiplySelf(): this { return this; }
  translateSelf(): this { return this; }
  scaleSelf(): this { return this; }
  invertSelf(): this { return this; }
}

function minimalPdf(lines: string[]): ArrayBuffer {
  const escaped = lines.map((line) => line.replace(/([\\()])/g, '\\$1'));
  const commands = escaped.map((line, index) => `${index ? '0 -24 Td ' : ''}(${line}) Tj`).join(' ');
  const stream = `BT /F1 15 Tf 72 720 Td ${commands} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf).buffer;
}

describe('PDF converter', () => {
  it('reads native PDF text without OCR or page rasterisation', async () => {
    Object.defineProperty(globalThis, 'DOMMatrix', { value: TestDOMMatrix, configurable: true });
    const { convertPdf } = await import('../converters/pdf');
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href;
    const buffer = minimalPdf(['Convergence theorem', 'The iterates converge monotonically.']);
    const file = new File([buffer], 'theorem.pdf', { type: 'application/pdf' });
    const context: ConverterContext = {
      options: { ...DEFAULT_OPTIONS, preserveVisualPages: false, runOcr: false, includeMetadata: false },
      onProgress: () => undefined,
    };
    const result = await convertPdf(file, buffer, context);
    expect(result.pageCount).toBe(1);
    expect(result.markdown).toContain('Convergence theorem');
    expect(result.markdown).toContain('converge monotonically');
    expect(result.metrics.find((metric) => metric.label === 'Text')?.value).toBe('Native text');
  });
});
