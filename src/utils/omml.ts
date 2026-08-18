import { attrLocal, directLocal, firstLocal, localElements, textOf } from './xml';
import { unicodeMathToLatex } from './markdown';

const SYMBOLS: Record<string, string> = {
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint',
  '∮': '\\oint', '∞': '\\infty', '−': '-', '×': '\\times', '·': '\\cdot',
  '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '→': '\\to', '↦': '\\mapsto',
  '∈': '\\in', '∂': '\\partial', '∇': '\\nabla', '±': '\\pm', '∓': '\\mp',
};

function escapeText(text: string): string {
  return unicodeMathToLatex(Array.from(text)
    .map((character) => SYMBOLS[character] ?? character)
    .join(''))
    .replace(/(?<!\\)([#$%&])/g, '\\$1')
    .replace(/\s+/g, ' ');
}

function child(element: Element, name: string): Element | undefined {
  return directLocal(element, name)[0];
}

function propertyValue(element: Element, property: string, fallback = ''): string {
  const propertyElement = firstLocal(element, property);
  const propertyAttribute = propertyElement ? attrLocal(propertyElement, 'val') : undefined;
  if (propertyAttribute !== undefined) return propertyAttribute;
  const valueElement = propertyElement ? Array.from(propertyElement.children)[0] : undefined;
  return valueElement ? attrLocal(valueElement, 'val') ?? valueElement.textContent ?? fallback : fallback;
}

function convertChildren(element: Element): string {
  return Array.from(element.children).map(convertNode).join('');
}

function convertMatrix(element: Element): string {
  const rows = directLocal(element, 'mr').map((row) =>
    directLocal(row, 'e').map((entry) => convertChildren(entry)).join(' & '),
  );
  return `\\begin{matrix}${rows.join(' \\\\ ')}\\end{matrix}`;
}

function convertDelimiter(element: Element): string {
  const opening = propertyValue(element, 'begChr', '(') || '.';
  const closing = propertyValue(element, 'endChr', ')') || '.';
  const body = directLocal(element, 'e').map(convertChildren).join(' \\middle| ');
  const delimiter = (value: string): string => ({
    '{': '\\{', '}': '\\}', '‖': '\\Vert', '∥': '\\Vert', '⟨': '\\langle', '⟩': '\\rangle',
  })[value] ?? escapeText(value);
  return `\\left${delimiter(opening)}${body}\\right${delimiter(closing)}`;
}

function convertNary(element: Element): string {
  const operator = propertyValue(element, 'chr', '∑');
  const base = SYMBOLS[operator] ?? escapeText(operator);
  const lower = child(element, 'sub');
  const upper = child(element, 'sup');
  const expression = child(element, 'e');
  return `${base}${lower ? `_{${convertChildren(lower)}}` : ''}${upper ? `^{${convertChildren(upper)}}` : ''}${expression ? ` ${convertChildren(expression)}` : ''}`;
}

function convertAccent(element: Element): string {
  const character = propertyValue(element, 'chr', '̂');
  const command: Record<string, string> = {
    '̂': 'hat', '̃': 'tilde', '̄': 'bar', '⃗': 'vec', '̇': 'dot', '̈': 'ddot', '⌢': 'widehat',
  };
  const expression = child(element, 'e');
  return `\\${command[character] ?? 'hat'}{${expression ? convertChildren(expression) : ''}}`;
}

function convertNode(element: Element): string {
  switch (element.localName) {
    case 't':
      return escapeText(element.textContent ?? '');
    case 'r':
      return textOf(element, 't') ? escapeText(textOf(element, 't')) : convertChildren(element);
    case 'f': {
      const numerator = child(element, 'num');
      const denominator = child(element, 'den');
      return `\\frac{${numerator ? convertChildren(numerator) : ''}}{${denominator ? convertChildren(denominator) : ''}}`;
    }
    case 'sSup': {
      const base = child(element, 'e');
      const superscript = child(element, 'sup');
      return `{${base ? convertChildren(base) : ''}}^{${superscript ? convertChildren(superscript) : ''}}`;
    }
    case 'sSub': {
      const base = child(element, 'e');
      const subscript = child(element, 'sub');
      return `{${base ? convertChildren(base) : ''}}_{${subscript ? convertChildren(subscript) : ''}}`;
    }
    case 'sSubSup': {
      const base = child(element, 'e');
      const subscript = child(element, 'sub');
      const superscript = child(element, 'sup');
      return `{${base ? convertChildren(base) : ''}}_{${subscript ? convertChildren(subscript) : ''}}^{${superscript ? convertChildren(superscript) : ''}}`;
    }
    case 'rad': {
      const degree = child(element, 'deg');
      const expression = child(element, 'e');
      const degreeText = degree ? convertChildren(degree) : '';
      return degreeText
        ? `\\sqrt[${degreeText}]{${expression ? convertChildren(expression) : ''}}`
        : `\\sqrt{${expression ? convertChildren(expression) : ''}}`;
    }
    case 'nary':
      return convertNary(element);
    case 'd':
      return convertDelimiter(element);
    case 'm':
      return convertMatrix(element);
    case 'eqArr':
      return `\\begin{aligned}${directLocal(element, 'e').map(convertChildren).join(' \\\\ ')}\\end{aligned}`;
    case 'acc':
      return convertAccent(element);
    case 'bar': {
      const expression = child(element, 'e');
      const position = propertyValue(element, 'pos', 'top');
      return `\\${position === 'bot' ? 'underline' : 'overline'}{${expression ? convertChildren(expression) : ''}}`;
    }
    case 'limLow':
    case 'limUpp': {
      const expression = child(element, 'e');
      const limit = child(element, 'lim');
      const marker = element.localName === 'limLow' ? '_' : '^';
      return `{${expression ? convertChildren(expression) : ''}}${marker}{${limit ? convertChildren(limit) : ''}}`;
    }
    case 'func': {
      const functionName = child(element, 'fName');
      const expression = child(element, 'e');
      const name = functionName ? convertChildren(functionName).trim() : '';
      const recognised = /^(?:sin|cos|tan|cot|sec|csc|log|ln|exp|lim|min|max|det|gcd)$/i.test(name)
        ? `\\${name.toLowerCase()}`
        : name ? `\\operatorname{${name}}` : '';
      return `${recognised}\\,${expression ? convertChildren(expression) : ''}`;
    }
    case 'groupChr': {
      const expression = child(element, 'e');
      const character = propertyValue(element, 'chr', '⏞');
      const command = character.includes('⏟') ? 'underbrace' : 'overbrace';
      return `\\${command}{${expression ? convertChildren(expression) : ''}}`;
    }
    case 'box':
    case 'borderBox': {
      const expression = child(element, 'e');
      return `\\boxed{${expression ? convertChildren(expression) : ''}}`;
    }
    case 'oMath':
    case 'oMathPara':
    case 'e':
    case 'num':
    case 'den':
    case 'sub':
    case 'sup':
    case 'deg':
    case 'lim':
    case 'fName':
      return convertChildren(element);
    default:
      return convertChildren(element);
  }
}

export function ommlToLatex(element: Element): string {
  return convertNode(element)
    .replace(/\u2009/g, '\\,')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MathToken {
  token: string;
  markdown: string;
}

export function tokenizeOmml(document: XMLDocument): MathToken[] {
  const candidates = localElements(document, 'oMathPara');
  const inline = localElements(document, 'oMath').filter(
    (element) => {
      let parent = element.parentElement;
      while (parent) {
        if (parent.localName === 'oMathPara') return false;
        parent = parent.parentElement;
      }
      return true;
    },
  );
  const elements = [...candidates, ...inline];
  const tokens: MathToken[] = [];
  elements.forEach((element, index) => {
    const display = element.localName === 'oMathPara';
    const token = `FIDELITYMATH${index}TOKEN`;
    const latex = ommlToLatex(element);
    tokens.push({ token, markdown: display ? `\n\n$$\n${latex}\n$$\n\n` : `$${latex}$` });

    const run = document.createElementNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'w:r',
    );
    const text = document.createElementNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'w:t',
    );
    text.textContent = token;
    run.append(text);
    element.replaceWith(run);
  });
  return tokens;
}
