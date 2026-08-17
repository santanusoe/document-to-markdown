import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { convertDocx } from '../converters/docx';
import { convertPptx } from '../converters/pptx';
import { convertSpreadsheet } from '../converters/spreadsheet';
import { convertTextLike } from '../converters/text';
import { DEFAULT_OPTIONS, type ConverterContext } from '../types';

const context: ConverterContext = { options: DEFAULT_OPTIONS, onProgress: () => undefined };

async function minimalDocx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
      <w:body>
        <w:p><w:r><w:t>Energy estimate</w:t></w:r></w:p>
        <w:p><w:r><w:t>For </w:t></w:r><m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath><w:r><w:t> we have:</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Method</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rate</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>GRAAL</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>O(1/N)</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        <w:sectPr/>
      </w:body>
    </w:document>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function minimalPptx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Convergence</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>Monotone and Lipschitz</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('Structured format converters', () => {
  it('recovers DOCX text, tables, and native Office Math as LaTeX', async () => {
    const buffer = await minimalDocx();
    const file = new File([buffer], 'proof.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const result = await convertDocx(file, buffer, context);
    expect(result.markdown).toContain('Energy estimate');
    expect(result.markdown).toContain('$');
    expect(result.markdown).toContain('x}^{2}');
    expect(result.markdown).toContain('Method');
    expect(result.metrics.find((metric) => metric.label === 'Equations')?.value).toContain('1');
  });

  it('orders PPTX title and body text from slide XML', async () => {
    const buffer = await minimalPptx();
    const file = new File([buffer], 'talk.pptx');
    const result = await convertPptx(file, buffer, context);
    expect(result.markdown).toContain('## Convergence');
    expect(result.markdown).toContain('Monotone and Lipschitz');
    expect(result.pageCount).toBe(1);
  });

  it('preserves spreadsheet values and formula source', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Method', 'Value'], ['Adaptive', 2]]);
    sheet.B2 = { t: 'n', v: 2, f: '1+1', w: '2' };
    XLSX.utils.book_append_sheet(workbook, sheet, 'Rates');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const file = new File([buffer], 'rates.xlsx');
    const result = await convertSpreadsheet(file, buffer, context);
    expect(result.markdown).toContain('## Rates');
    expect(result.markdown).toContain('formula: =1+1');
  });

  it('parses quoted CSV deterministically', () => {
    const text = 'name,note\nA,"x, y"\n';
    const buffer = new TextEncoder().encode(text).buffer;
    const result = convertTextLike(new File([buffer], 'data.csv'), buffer, DEFAULT_OPTIONS);
    expect(result.markdown).toContain('| A | x, y |');
  });
});
