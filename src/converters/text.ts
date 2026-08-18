import type { ConversionOptions, Metric } from '../types';
import { fenced, htmlToMarkdown, markdownTable, normalizeMarkdown } from '../utils/markdown';
import { extensionOf, stemOf } from '../utils/files';
import { parseXml } from '../utils/xml';

export interface TextConversion {
  markdown: string;
  metrics: Metric[];
  warnings: string[];
  sourceType: string;
}

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.slice(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = bytes.slice(2);
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const first = swapped[index];
      swapped[index] = swapped[index + 1] ?? 0;
      swapped[index + 1] = first ?? 0;
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
}

function csvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((value) => value.length)) rows.push(row);
  return rows;
}

function stripRtf(input: string): string {
  const unicode = input.replace(/\\u(-?\d+)\??/g, (_match, value: string) =>
    String.fromCodePoint(Number(value) < 0 ? Number(value) + 65_536 : Number(value)),
  );
  return unicode
    .replace(/\\'([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\par[d]?\b/g, '\n\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\([{}\\])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function latexTabularToMarkdown(body: string): string {
  const rows = body
    .replace(/\\(?:toprule|midrule|bottomrule|hline|cline\{[^}]*})/g, '')
    .split(/\\\\(?:\[[^\]]*])?\s*(?:\r?\n|$)/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split(/(?<!\\)&/).map((cell) => cell
      .replace(/\\multicolumn\{\d+}\{[^}]*}\{([^}]*)}/g, '$1')
      .replace(/\\(?:textbf|textit|emph)\{([^{}]*)}/g, '$1')
      .replace(/\\&/g, '&')
      .trim()));
  return markdownTable(rows);
}

function latexToMarkdown(input: string): string {
  let output = input
    .replace(/(?<!\\)%.*$/gm, '')
    .replace(/\\begin\{tabular}\{[^}]*}([\s\S]*?)\\end\{tabular}/g, (_match, body: string) => `\n\n${latexTabularToMarkdown(body)}\n\n`)
    .replace(/\\documentclass(?:\[[^\]]*])?\{[^}]*}/g, '')
    .replace(/\\usepackage(?:\[[^\]]*])?\{[^}]*}/g, '')
    .replace(/\\begin\{document}|\\end\{document}/g, '')
    .replace(/\\section\*?\{([^}]*)}/g, '# $1')
    .replace(/\\subsection\*?\{([^}]*)}/g, '## $1')
    .replace(/\\subsubsection\*?\{([^}]*)}/g, '### $1')
    .replace(/\\paragraph\*?\{([^}]*)}/g, '#### $1')
    .replace(/\\textbf\{([^{}]*)}/g, '**$1**')
    .replace(/\\(?:textit|emph)\{([^{}]*)}/g, '*$1*')
    .replace(/\\begin\{(?:equation\*?|displaymath)}([\s\S]*?)\\end\{(?:equation\*?|displaymath)}/g, (_match, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`)
    .replace(/\\begin\{(?:align\*?|aligned|gather\*?|multline\*?)}([\s\S]*?)\\end\{(?:align\*?|aligned|gather\*?|multline\*?)}/g, (_match, body: string) => `\n\n$$\n\\begin{aligned}\n${body.trim()}\n\\end{aligned}\n$$\n\n`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body.trim()}$`)
    .replace(/\\begin\{itemize}/g, '')
    .replace(/\\begin\{enumerate}/g, '')
    .replace(/\\end\{itemize}|\\end\{enumerate}/g, '')
    .replace(/\\item\s+/g, '- ')
    .replace(/\\cite(?:t|p)?\{([^}]*)}/g, '[$1]')
    .replace(/\\label\{[^}]*}/g, '')
    .replace(/\\ref\{([^}]*)}/g, '$1');
  const title = output.match(/\\title\{([^}]*)}/)?.[1];
  output = output.replace(/\\title\{[^}]*}/g, '').replace(/\\author\{[^}]*}/g, '').replace(/\\maketitle/g, '');
  return normalizeMarkdown(`${title ? `# ${title}\n\n` : ''}${output}`);
}

function notebookToMarkdown(input: string): string {
  const notebook = JSON.parse(input) as {
    cells?: Array<{ cell_type?: string; source?: string[] | string; outputs?: Array<Record<string, unknown>> }>;
  };
  const parts: string[] = [];
  for (const cell of notebook.cells ?? []) {
    const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source ?? '';
    if (cell.cell_type === 'markdown') parts.push(source);
    else if (cell.cell_type === 'code') {
      parts.push(fenced(source, 'python'));
      for (const output of cell.outputs ?? []) {
        const text = output.text;
        if (Array.isArray(text)) parts.push(fenced(text.join(''), 'text'));
        else if (typeof text === 'string') parts.push(fenced(text, 'text'));
      }
    } else if (source) parts.push(fenced(source, 'text'));
  }
  return normalizeMarkdown(parts.join('\n\n'));
}

function xmlToMarkdown(input: string): string {
  try {
    const document = parseXml(input);
    const root = document.documentElement;
    const title = root.localName || 'XML document';
    return normalizeMarkdown(`# ${title}\n\n${fenced(input, 'xml')}`);
  } catch {
    return normalizeMarkdown(fenced(input, 'xml'));
  }
}

export function convertTextLike(
  file: File,
  buffer: ArrayBuffer,
  _options: ConversionOptions,
): TextConversion {
  const extension = extensionOf(file.name);
  const text = decodeText(buffer);
  const warnings: string[] = [];
  let markdown = '';
  let sourceType = extension.toUpperCase() || 'Text';

  if (extension === 'html' || extension === 'htm') {
    const document = new DOMParser().parseFromString(text, 'text/html');
    document.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
    markdown = htmlToMarkdown(document.body.innerHTML);
    sourceType = 'HTML';
  } else if (extension === 'csv' || extension === 'tsv') {
    markdown = normalizeMarkdown(`# ${stemOf(file.name)}\n\n${markdownTable(csvRows(text, extension === 'tsv' ? '\t' : ','))}`);
    sourceType = extension.toUpperCase();
  } else if (extension === 'rtf') {
    markdown = normalizeMarkdown(`# ${stemOf(file.name)}\n\n${stripRtf(text)}`);
    warnings.push('RTF conversion preserves readable text, but complex floating objects and legacy field codes require review.');
    sourceType = 'RTF';
  } else if (extension === 'tex' || extension === 'latex') {
    markdown = latexToMarkdown(text);
    sourceType = 'LaTeX';
  } else if (extension === 'ipynb') {
    markdown = notebookToMarkdown(text);
    sourceType = 'Jupyter notebook';
  } else if (extension === 'json') {
    try {
      markdown = normalizeMarkdown(`# ${stemOf(file.name)}\n\n${fenced(JSON.stringify(JSON.parse(text), null, 2), 'json')}`);
    } catch {
      markdown = normalizeMarkdown(fenced(text, 'json'));
      warnings.push('The file extension is JSON, but the content did not parse as valid JSON.');
    }
    sourceType = 'JSON';
  } else if (extension === 'xml' || extension === 'svg') {
    markdown = xmlToMarkdown(text);
    sourceType = extension.toUpperCase();
  } else if (extension === 'md' || extension === 'markdown') {
    markdown = normalizeMarkdown(text);
    sourceType = 'Markdown';
  } else {
    const binaryMarkers = ((text.match(/\uFFFD/g)?.length ?? 0) + (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length ?? 0)) / Math.max(1, text.length);
    if (binaryMarkers > 0.02) throw new Error('This binary format is not safely readable in the browser. Export it as PDF, DOCX, PPTX, XLSX, HTML, or plain text first.');
    const language = ['js', 'ts', 'py', 'java', 'c', 'cpp', 'rs', 'go', 'css', 'scss', 'sh', 'yaml', 'yml'].includes(extension)
      ? extension.replace('yml', 'yaml')
      : '';
    markdown = language ? normalizeMarkdown(fenced(text, language)) : normalizeMarkdown(text);
  }

  return {
    markdown,
    warnings,
    sourceType,
    metrics: [
      { label: 'Text', value: 'Direct', level: 'high', detail: 'Decoded directly from the source characters; no OCR or remote processing.' },
      { label: 'Structure', value: ['html', 'htm', 'md', 'markdown', 'tex', 'latex', 'ipynb'].includes(extension) ? 'Semantic' : 'Plain', level: 'high', detail: 'Source-native structure is mapped to Markdown where the format exposes it.' },
      { label: 'Tables', value: ['csv', 'tsv', 'html', 'htm'].includes(extension) ? 'Preserved' : 'N/A', level: 'high', detail: 'Delimited and HTML tables are converted deterministically.' },
      { label: 'Equations', value: ['tex', 'latex', 'md', 'markdown'].includes(extension) ? 'Native' : 'N/A', level: 'high', detail: 'Existing LaTeX delimiters and commands are retained.' },
    ],
  };
}
