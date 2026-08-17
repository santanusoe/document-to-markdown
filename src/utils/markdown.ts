import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const UNICODE_LATEX: Record<string, string> = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\varepsilon',
  'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota', 'κ': '\\kappa',
  'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho',
  'σ': '\\sigma', 'τ': '\\tau', 'φ': '\\varphi', 'ϕ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi',
  'ω': '\\omega', 'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
  'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '√': '\\sqrt{}', '∞': '\\infty',
  '∂': '\\partial', '∇': '\\nabla', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq',
  '≈': '\\approx', '≃': '\\simeq', '≡': '\\equiv', '∈': '\\in', '∉': '\\notin',
  '⊂': '\\subset', '⊆': '\\subseteq', '⊃': '\\supset', '⊇': '\\supseteq',
  '∪': '\\cup', '∩': '\\cap', '∅': '\\varnothing', '∀': '\\forall', '∃': '\\exists',
  '¬': '\\neg', '∧': '\\land', '∨': '\\lor', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow',
  '→': '\\to', '↦': '\\mapsto', '←': '\\leftarrow', '±': '\\pm', '·': '\\cdot',
  '×': '\\times', '÷': '\\div', '∘': '\\circ', '⊥': '\\perp', '∥': '\\Vert',
  '‖': '\\Vert', 'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}',
  'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}', 'ℋ': '\\mathcal{H}', '…': '\\ldots',
};

export function unicodeMathToLatex(input: string): string {
  let output = '';
  for (const symbol of input) output += UNICODE_LATEX[symbol] ?? symbol;
  return output
    .replace(/([A-Za-z0-9})\]])([₀₁₂₃₄₅₆₇₈₉]+)/g, (_match, base: string, sub: string) =>
      `${base}_{${sub.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (digit) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(digit)))}}`,
    )
    .replace(/([A-Za-z0-9})\]])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_match, base: string, sup: string) =>
      `${base}^{${sup.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) => String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(digit)))}}`,
    )
    .replace(/\\sqrt\{\}\s*([^\s+\-=]+)/g, '\\sqrt{$1}')
    .replace(/\s+/g, ' ')
    .trim();
}

export function looksMathematical(text: string): boolean {
  const compact = text.replace(/\s/g, '');
  if (compact.length < 2) return false;
  const mathSymbols = compact.match(/[=<>≤≥≠≈∑∏∫√∞∂∇α-ωΑ-Ω^_{}()[\]|+*/−]/gu)?.length ?? 0;
  const proseLetters = compact.match(/[A-Za-z]/g)?.length ?? 0;
  return mathSymbols >= 2 && mathSymbols / compact.length > 0.12 && proseLetters / compact.length < 0.72;
}

export function escapeTableCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

export function markdownTable(rows: unknown[][]): string {
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (!width || !rows.length) return '';
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => escapeTableCell(row[index])));
  const header = normalized[0] ?? [];
  const body = normalized.slice(1);
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  turndown.use(gfm);
  turndown.addRule('preserveComplexTables', {
    filter: (node) =>
      node.nodeName === 'TABLE' &&
      Boolean((node as HTMLElement).querySelector('[rowspan], [colspan]')),
    replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`,
  });
  turndown.addRule('mathTokens', {
    filter: (node) => node.nodeName === 'SPAN' && (node as HTMLElement).dataset.math !== undefined,
    replacement: (_content, node) => (node as HTMLElement).dataset.math ?? '',
  });
  return normalizeMarkdown(turndown.turndown(html));
}

export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/^\s+|\s+$/g, '')
    .concat('\n');
}

export function dehyphenateLines(lines: string[]): string[] {
  const output: string[] = [];
  for (const line of lines) {
    const previous = output.at(-1);
    if (
      previous &&
      /[a-z]{2,}-$/.test(previous) &&
      /^[a-z]/.test(line.trim()) &&
      !/[–—]$/.test(previous)
    ) {
      output[output.length - 1] = previous.slice(0, -1) + line.trim();
    } else {
      output.push(line);
    }
  }
  return output;
}

export function wordCount(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/[#>*_`$|{}[\]()-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function fenced(text: string, language = ''): string {
  const longest = Math.max(3, ...(text.match(/`+/g)?.map((run) => run.length + 1) ?? [3]));
  const fence = '`'.repeat(longest);
  return `${fence}${language}\n${text.trimEnd()}\n${fence}`;
}
