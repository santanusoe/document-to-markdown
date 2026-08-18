import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const UNICODE_LATEX: Record<string, string> = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\varepsilon',
  'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota', 'κ': '\\kappa',
  'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho',
  'σ': '\\sigma', 'τ': '\\tau', 'φ': '\\varphi', 'ϕ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi',
  'ω': '\\omega', 'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
  'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint',
  '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap', '√': '\\sqrt{}', '∞': '\\infty',
  '∂': '\\partial', '∇': '\\nabla', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq',
  '≈': '\\approx', '≃': '\\simeq', '≅': '\\cong', '≡': '\\equiv', '∼': '\\sim',
  '≪': '\\ll', '≫': '\\gg', '∝': '\\propto', '∈': '\\in', '∉': '\\notin',
  '⊂': '\\subset', '⊆': '\\subseteq', '⊃': '\\supset', '⊇': '\\supseteq',
  '∪': '\\cup', '∩': '\\cap', '∅': '\\varnothing', '∀': '\\forall', '∃': '\\exists',
  '¬': '\\neg', '∧': '\\land', '∨': '\\lor', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow',
  '→': '\\to', '↦': '\\mapsto', '←': '\\leftarrow', '↔': '\\leftrightarrow',
  '↑': '\\uparrow', '↓': '\\downarrow', '±': '\\pm', '∓': '\\mp', '·': '\\cdot',
  '×': '\\times', '÷': '\\div', '∘': '\\circ', '⊕': '\\oplus', '⊗': '\\otimes',
  '⊙': '\\odot', '⊥': '\\perp', '∥': '\\parallel', '‖': '\\Vert', '∠': '\\angle',
  '∣': '\\mid', '∗': '\\ast', '⋅': '\\cdot', '⋆': '\\star', '⋄': '\\diamond',
  '⌈': '\\lceil', '⌉': '\\rceil', '⌊': '\\lfloor', '⌋': '\\rfloor',
  '⟨': '\\langle', '⟩': '\\rangle', '⊤': '\\top', '⊢': '\\vdash', '⊨': '\\models',
  '′': "'", '″': "''", '‴': "'''",
  '∴': '\\therefore', '∵': '\\because', 'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}',
  'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}', 'ℋ': '\\mathcal{H}', '…': '\\ldots',
  'ℓ': '\\ell', 'ℏ': '\\hbar', 'ℜ': '\\Re', 'ℑ': '\\Im',
  '½': '\\frac{1}{2}', '⅓': '\\frac{1}{3}', '⅔': '\\frac{2}{3}',
  '¼': '\\frac{1}{4}', '¾': '\\frac{3}{4}', '⅕': '\\frac{1}{5}',
  '⅖': '\\frac{2}{5}', '⅗': '\\frac{3}{5}', '⅘': '\\frac{4}{5}',
  '⅙': '\\frac{1}{6}', '⅚': '\\frac{5}{6}', '⅛': '\\frac{1}{8}',
  '⅜': '\\frac{3}{8}', '⅝': '\\frac{5}{8}', '⅞': '\\frac{7}{8}',
  '−': '-',
};

const COMBINING_ACCENTS: Record<string, string> = {
  '\u0302': '\\hat',
  '\u0304': '\\bar',
  '\u0303': '\\tilde',
  '\u0307': '\\dot',
  '\u0308': '\\ddot',
  '\u20d7': '\\vec',
};

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6',
  '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(',
  '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i',
};

const SUBSCRIPTS: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6',
  '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', '₌': '=', '₍': '(',
  '₎': ')', 'ₐ': 'a', 'ₑ': 'e', 'ₕ': 'h', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k',
  'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₒ': 'o', 'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's',
  'ₜ': 't', 'ₓ': 'x',
};

function mappedScript(
  characters: string[],
  start: number,
  mapping: Record<string, string>,
): { latex: string; end: number } {
  let value = '';
  let end = start;
  while (end < characters.length && mapping[characters[end] ?? ''] !== undefined) {
    value += mapping[characters[end] ?? ''];
    end += 1;
  }
  return { latex: value, end };
}

export function unicodeMathToLatex(input: string): string {
  const output: string[] = [];
  // Decompose accented letters only. Mathematical relation glyphs such as ≠
  // also have canonical decompositions, but must stay intact for symbol maps.
  const characters = Array.from(input.normalize('NFC')).flatMap((character) => {
    if (UNICODE_LATEX[character] || SUPERSCRIPTS[character] || SUBSCRIPTS[character]) return [character];
    const decomposed = Array.from(character.normalize('NFD'));
    return decomposed.length > 1 && decomposed.slice(1).every((mark) => COMBINING_ACCENTS[mark])
      ? decomposed
      : [character];
  });
  for (let index = 0; index < characters.length; index += 1) {
    const symbol = characters[index] ?? '';
    if (COMBINING_ACCENTS[symbol]) {
      const base = output.pop();
      if (base?.trim()) output.push(`${COMBINING_ACCENTS[symbol]}{${base.trim()}}`);
      continue;
    }
    if (SUPERSCRIPTS[symbol] !== undefined) {
      const script = mappedScript(characters, index, SUPERSCRIPTS);
      output.push(`^{${script.latex}}`);
      index = script.end - 1;
      continue;
    }
    if (SUBSCRIPTS[symbol] !== undefined) {
      const script = mappedScript(characters, index, SUBSCRIPTS);
      output.push(`_{${script.latex}}`);
      index = script.end - 1;
      continue;
    }
    const replacement = UNICODE_LATEX[symbol] ?? symbol;
    output.push(replacement);
    const next = characters[index + 1] ?? '';
    // TeX command names consume following letters. A source such as αx must
    // become "\\alpha x", not the undefined command "\\alphax".
    if (/^\\[A-Za-z]+$/.test(replacement) && /^[A-Za-z]$/.test(next)) output.push(' ');
  }
  return output.join('')
    .replace(/<=>|<->/g, ' \\leftrightarrow ')
    .replace(/=>/g, ' \\Rightarrow ')
    .replace(/->/g, ' \\to ')
    .replace(/<=/g, ' \\leq ')
    .replace(/>=/g, ' \\geq ')
    .replace(/!=/g, ' \\neq ')
    .replace(/(?<!\\)\b(arcsin|arccos|arctan|sin|cos|tan|sinh|cosh|tanh|log|ln|exp|lim|sup|inf|max|min|det|gcd)\b/g, '\\$1')
    .replace(/([_^])(?!\{)([A-Za-z0-9+-]+)/g, '$1{$2}')
    .replace(/((?:\\partial|\\nabla)\s*[A-Za-z]|[A-Za-z0-9]+(?:_\{[^{}]+\}|\^\{[^{}]+\})*)\s*\/\s*((?:\\partial|\\nabla)\s*[A-Za-z]|[A-Za-z0-9]+(?:_\{[^{}]+\}|\^\{[^{}]+\})*)/g, '\\frac{$1}{$2}')
    .replace(/\\sqrt\{\}\s*\(([^()]*)\)/g, '\\sqrt{$1}')
    .replace(/\\sqrt\{\}\s*((?:\\[A-Za-z]+(?:\{[^{}]*})?|[A-Za-z0-9])(?:_\{[^{}]*}|\^\{[^{}]*})*)/g, '\\sqrt{$1}')
    .replace(/[\u2000-\u200A\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inlineMath(input: string): string {
  return `$${unicodeMathToLatex(input).replace(/(?<!\\)\$/g, '\\$')}$`;
}

export function displayMath(input: string | string[]): string {
  const lines = Array.isArray(input) ? input : [input];
  const converted = lines.map((line) => unicodeMathToLatex(line)).filter(Boolean);
  const body = converted.length > 1
    ? `\\begin{aligned}\n${converted.join(' \\\\ \n')}\n\\end{aligned}`
    : converted[0] ?? '';
  return `$$\n${body}\n$$`;
}

export function looksMathematical(text: string): boolean {
  const compact = text.replace(/\s/g, '');
  if (compact.length < 2) return false;
  const mathSymbols = compact.match(/[=<>≤≥≠≈∑∏∫√∞∂∇α-ωΑ-Ω⁰-⁹₀-₉^_{}()[\]|+*/−]/gu)?.length ?? 0;
  const proseLetters = compact.match(/[A-Za-z]/g)?.length ?? 0;
  const equationSignal = /[=≤≥≠≈]/u.test(compact) && /[A-Za-zα-ωΑ-Ω0-9]/u.test(compact);
  return (mathSymbols >= 2 || equationSignal) && mathSymbols / compact.length > 0.08 && proseLetters / compact.length < 0.78;
}

export function escapeTableCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>')
    .replace(/(?<!\\)\|/g, '\\|')
    .replace(/\\$/g, '\\\\')
    .trim();
}

function numericColumn(cells: string[]): boolean {
  const present = cells.map((cell) => cell.replace(/<br>/g, ' ').replace(/<!--.*?-->/g, '').trim()).filter(Boolean);
  if (present.length < 2) return false;
  const numeric = present.filter((cell) => /^[-+]?\s*(?:[$€£¥₹]\s*)?(?:\d{1,3}(?:[ ,]\d{3})*|\d+)(?:[.,]\d+)?(?:\s*%|\s*[A-Za-z]{1,4})?$/.test(cell));
  return numeric.length / present.length >= 0.72;
}

export function markdownTable(rows: unknown[][]): string {
  let width = Math.max(0, ...rows.map((row) => row.length));
  if (!width || !rows.length) return '';
  while (width > 1 && rows.every((row) => !String(row[width - 1] ?? '').trim())) width -= 1;
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => escapeTableCell(row[index])));
  const header = normalized[0] ?? [];
  const body = normalized.slice(1);
  const separators = header.map((_cell, column) => numericColumn(body.map((row) => row[column] ?? '')) ? '---:' : '---');
  return [
    `| ${header.join(' | ')} |`,
    `| ${separators.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function protectHtmlMath(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  const textNodes: Text[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node as Text);
      return;
    }
    if (node instanceof Element && /^(?:CODE|PRE|SCRIPT|STYLE|TEXTAREA)$/i.test(node.tagName)) return;
    Array.from(node.childNodes).forEach(visit);
  };
  visit(root);
  const mathPattern = /(?<!\\)\$\$[\s\S]+?(?<!\\)\$\$|\\\[[\s\S]+?\\\]|(?<!\\)\$(?!\$)(?:\\.|[^$\n])+?(?<!\\)\$|\\\((?:\\.|[^\n])+?\\\)/g;
  for (const textNode of textNodes) {
    const source = textNode.data;
    const matches = Array.from(source.matchAll(mathPattern));
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      const start = match.index ?? 0;
      if (start > cursor) fragment.append(document.createTextNode(source.slice(cursor, start)));
      const span = document.createElement('span');
      span.dataset.math = match[0] ?? '';
      span.textContent = match[0] ?? '';
      fragment.append(span);
      cursor = start + (match[0]?.length ?? 0);
    }
    if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
    textNode.replaceWith(fragment);
  }
  return root.innerHTML;
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
  return normalizeMarkdown(turndown.turndown(protectHtmlMath(html)));
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
