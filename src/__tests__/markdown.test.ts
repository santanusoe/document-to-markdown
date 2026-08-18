import { describe, expect, it } from 'vitest';
import { dehyphenateLines, htmlToMarkdown, markdownTable, unicodeMathToLatex } from '../utils/markdown';
import { ommlToLatex } from '../utils/omml';
import { parseXml } from '../utils/xml';

describe('Markdown utilities', () => {
  it('maps mathematical Unicode without changing ordinary text', () => {
    expect(unicodeMathToLatex('∀ x ∈ ℝ: x² ≥ 0')).toBe('\\forall x \\in \\mathbb{R}: x^{2} \\geq 0');
  });

  it('produces valid GFM tables and escapes pipes', () => {
    expect(markdownTable([['Method', 'Rate'], ['GRAAL', 'O(1/N)'], ['A | B', 'fast']]))
      .toContain('| A \\| B | fast |');
  });

  it('keeps complex HTML table spans instead of flattening them incorrectly', () => {
    const markdown = htmlToMarkdown('<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>');
    expect(markdown).toContain('rowspan="2"');
  });

  it('keeps HTML-embedded display math byte-for-byte instead of Markdown-escaping TeX commands', () => {
    expect(htmlToMarkdown('<p>$$\\|x\\|^2 \\leq 1$$</p>')).toBe('$$\\|x\\|^2 \\leq 1$$\n');
  });

  it('repairs line-wrap hyphenation conservatively', () => {
    expect(dehyphenateLines(['mono-', 'tone operator', 'well-posed'])).toEqual(['monotone operator', 'well-posed']);
  });

  it('reads OMML property attributes for delimiters and n-ary limits', () => {
    const document = parseXml(`<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val="}"/></m:dPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d></m:oMath>`);
    expect(ommlToLatex(document.documentElement)).toBe('\\left\\{x\\right\\}');
  });
});
