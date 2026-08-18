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

function pdfFromStream(stream: string): ArrayBuffer {
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

function minimalPdf(lines: string[]): ArrayBuffer {
  const escaped = lines.map((line) => line.replace(/([\\()])/g, '\\$1'));
  const commands = escaped.map((line, index) => `${index ? '0 -24 Td ' : ''}(${line}) Tj`).join(' ');
  return pdfFromStream(`BT /F1 15 Tf 72 720 Td ${commands} ET`);
}

function structuredPdf(): ArrayBuffer {
  return pdfFromStream([
    'BT /F1 24 Tf 72 730 Td (Research Findings) Tj ET',
    'BT /F1 11 Tf 72 690 Td (The reconstruction is reli-) Tj ET',
    'BT /F1 11 Tf 72 675 Td (able across cohorts and preserves order.) Tj ET',
    'BT /F1 11 Tf 72 660 Td (The final sentence remains aligned.) Tj ET',
    'BT /F1 11 Tf 72 605 Td (Method) Tj ET',
    'BT /F1 11 Tf 245 605 Td (Rate) Tj ET',
    'BT /F1 11 Tf 390 605 Td (Calls) Tj ET',
    'BT /F1 11 Tf 72 588 Td (Baseline) Tj ET',
    'BT /F1 11 Tf 245 588 Td (1/N) Tj ET',
    'BT /F1 11 Tf 390 588 Td (2) Tj ET',
    'BT /F1 11 Tf 72 571 Td (Accelerated) Tj ET',
    'BT /F1 11 Tf 245 571 Td (1/N^2) Tj ET',
    'BT /F1 11 Tf 390 571 Td (1) Tj ET',
    'BT /F1 12 Tf 72 525 Td (Equation 1) Tj ET',
    'BT /F1 12 Tf 170 525 Td (E=mc) Tj ET',
    'BT /F1 8 Tf 202 530 Td (2) Tj ET',
    'BT /F1 8 Tf 190 500 Td (x+1) Tj ET',
    'BT /F1 12 Tf 72 486 Td (Equation 2 f(x) =) Tj ET',
    'BT /F1 12 Tf 238 486 Td (+ z) Tj ET',
    'BT /F1 8 Tf 190 473 Td (y-1) Tj ET',
    'q 0.8 w 184 486 m 224 486 l S Q',
  ].join('\n'));
}

describe('PDF converter', () => {
  it('reads native PDF text without OCR or page rasterisation', async () => {
    Object.defineProperty(globalThis, 'DOMMatrix', { value: TestDOMMatrix, configurable: true });
    Reflect.deleteProperty(Promise, 'try');
    const { convertPdf } = await import('../converters/pdf');
    expect(typeof (Promise as PromiseConstructor & { try?: unknown }).try).toBe('function');
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

  it('reconstructs heading hierarchy, dehyphenated paragraphs and aligned tables', async () => {
    Object.defineProperty(globalThis, 'DOMMatrix', { value: TestDOMMatrix, configurable: true });
    const { convertPdf } = await import('../converters/pdf');
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href;
    const buffer = structuredPdf();
    const file = new File([buffer], 'research.pdf', { type: 'application/pdf' });
    const context: ConverterContext = {
      options: { ...DEFAULT_OPTIONS, preserveVisualPages: false, runOcr: false, includeMetadata: false },
      onProgress: () => undefined,
    };
    const result = await convertPdf(file, buffer, context);
    expect(result.markdown).toContain('## Research Findings');
    expect(result.markdown).toContain('reliable across cohorts');
    expect(result.markdown).toContain('The final sentence remains aligned.');
    expect(result.markdown).toContain('| Method | Rate | Calls |');
    expect(result.markdown).toContain('| Accelerated | 1/N^2 | 1 |');
    expect(result.markdown).toContain('E=mc^{2}');
    expect(result.markdown).toContain('*Equation 1*');
    expect(result.markdown).not.toContain('^{Equation 1}');
    expect(result.markdown).toContain('*Equation 2*');
    expect(result.markdown).toContain('\\frac{x+1}{y-1}');
    expect(result.metrics.find((metric) => metric.label === 'Tables')?.value).toBe('1 detected');
    expect(result.metrics.find((metric) => metric.label === 'Layout')?.value).toContain('heading');
  });
});
