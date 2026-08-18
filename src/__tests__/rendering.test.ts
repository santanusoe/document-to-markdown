import katex from 'katex';
import { marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { imageRegionsFromCoordinates } from '../utils/figures';
import { displayMath, markdownTable, unicodeMathToLatex } from '../utils/markdown';

const formulaCases = [
  'αx + βy = γ',
  '∀ x ∈ ℝ: x² ≥ 0',
  '∑ₖ₌₀ⁿ k',
  '∫₀¹ x² dx',
  '√(x+1)',
  '½x + ¾y',
  '∇f(x) = 0',
  'A ⊆ B',
  'p ⇒ q',
  'x ≠ y',
  'a ∥ b',
  'θ → ∞',
  '∂u/∂t',
  'λ₁ ≤ λ₂',
  '10⁻³',
  'x⁽ⁿ⁺¹⁾',
  'H₀',
  'ℂ ∩ ℝ',
  'x ≈ y',
  'u ⊥ v',
  'a × b',
  'x · y',
  'Ωₙ',
  'φ(x)',
  '∃x',
  '∅ ⊂ A',
  'p ⇔ q',
  'f: A ↦ B',
  'x ∝ y',
  'a ≪ b',
  'C ≅ D',
  'x ∓ y',
  '∮ f dz',
  '∬Ω f',
  '∭V ρ',
  'A ⊕ B',
  'A ⊗ B',
  '∠ABC',
  '∴ x = y',
  'ℏω = E',
];

const tableCases: unknown[][][] = [
  [['Name', 'Value'], ['A', 1], ['B', 2]],
  [['Expression', 'Meaning'], ['A | B', 'choice'], ['x', 'plain']],
  [['Name', 'Notes'], ['A', 'line one\nline two'], ['B', 'single']],
  [['A', 'B', 'C'], ['one', 'two'], ['three', 'four', 'five']],
  [['A', 'B', ''], ['one', 'two', ''], ['three', 'four', '']],
  [['Variable', 'Formula'], ['x', '$x_1 \\mid y$'], ['y', '$y_2$']],
  [['Method', 'Rate'], ['Base', '12.5%'], ['New', '9.2%']],
  [['Column 1', 'Column 2'], ['', 'present'], ['present', '']],
];

describe('rendering fidelity benchmark', () => {
  it('renders all 40 representative Unicode-to-LaTeX cases without a KaTeX error', () => {
    for (const source of formulaCases) {
      const latex = unicodeMathToLatex(source);
      expect(() => katex.renderToString(latex, { displayMode: true, throwOnError: true, strict: 'error' })).not.toThrow();
    }
    expect(unicodeMathToLatex('αx + βy')).toBe('\\alpha x + \\beta y');
    const multiline = displayMath(['x₁ = y', 'x₂ = z']);
    expect(multiline).toContain(' \\\\ \n');
    expect(() => katex.renderToString(multiline.slice(2, -2).trim(), { displayMode: true, throwOnError: true })).not.toThrow();
  });

  it('produces eight GFM tables that the Markdown renderer recognises as tables', () => {
    for (const rows of tableCases) {
      const markdown = markdownTable(rows);
      const html = marked.parse(markdown, { gfm: true }) as string;
      expect(html).toContain('<table>');
      expect(html).toContain('<thead>');
      expect(html).toContain('<tbody>');
    }
    expect(markdownTable(tableCases[1] ?? [])).toContain('A \\| B');
    expect(markdownTable(tableCases[2] ?? [])).toContain('line one<br>line two');
    expect(markdownTable(tableCases[6] ?? [])).toContain('---:');
  });

  it('normalises and deduplicates four representative PDF image-coordinate records', () => {
    const coordinates = new Float32Array([
      0.1, 0.2, 0.1, 0.6, 0.7, 0.2,
      0.1, 0.2, 0.1, 0.6, 0.7, 0.2,
      -0.1, 0.4, -0.1, 0.8, 0.3, 0.4,
      0.8, 0.1, 0.8, 0.3, 1.2, 0.1,
    ]);
    const regions = imageRegionsFromCoordinates(coordinates);
    expect(regions).toHaveLength(3);
    expect(regions[0]?.left).toBeCloseTo(0.1);
    expect(regions[0]?.top).toBeCloseTo(0.2);
    expect(regions[0]?.right).toBeCloseTo(0.7);
    expect(regions[0]?.bottom).toBeCloseTo(0.6);
    expect(regions[1]?.left).toBe(0);
    expect(regions[2]?.right).toBe(1);
  });
});
