import { describe, expect, it } from 'vitest';
import { dehyphenateLines, htmlToMarkdown, markdownTable, unicodeMathToLatex } from '../utils/markdown';

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

  it('repairs line-wrap hyphenation conservatively', () => {
    expect(dehyphenateLines(['mono-', 'tone operator', 'well-posed'])).toEqual(['monotone operator', 'well-posed']);
  });
});
