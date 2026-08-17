declare module 'turndown-plugin-gfm' {
  import type { Plugin } from 'turndown';
  export const gfm: Plugin;
  export const tables: Plugin;
  export const strikethrough: Plugin;
  export const taskListItems: Plugin;
}

declare module 'katex/contrib/auto-render' {
  interface Delimiter {
    left: string;
    right: string;
    display: boolean;
  }

  interface RenderOptions {
    delimiters?: Delimiter[];
    throwOnError?: boolean;
    strict?: boolean | string;
  }

  export default function renderMathInElement(element: HTMLElement, options?: RenderOptions): void;
}

declare module 'mammoth/mammoth.browser' {
  export const images: typeof import('mammoth').images;
  export const convertToHtml: typeof import('mammoth').convertToHtml;
}
