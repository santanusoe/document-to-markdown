import type JSZip from 'jszip';
import { attrLocal, firstLocal, localElements, naturalSort, parseXml, textOf } from './xml';
import { markdownTable, normalizeMarkdown } from './markdown';

export interface ChartExtraction {
  markdown: string;
  count: number;
  warnings: string[];
}

function points(cache: Element | undefined): string[] {
  if (!cache) return [];
  return localElements(cache, 'pt')
    .sort((a, b) => Number(attrLocal(a, 'idx') ?? 0) - Number(attrLocal(b, 'idx') ?? 0))
    .map((point) => firstLocal(point, 'v')?.textContent ?? '');
}

function referenceValues(series: Element, referenceNames: string[]): string[] {
  for (const name of referenceNames) {
    const reference = firstLocal(series, name);
    if (!reference) continue;
    const cache = firstLocal(reference, 'strCache') ?? firstLocal(reference, 'numCache');
    const values = points(cache);
    if (values.length) return values;
  }
  return [];
}

export async function extractCharts(zip: JSZip, prefix: 'word' | 'ppt' | 'xl'): Promise<ChartExtraction> {
  const chartPaths = naturalSort(
    Object.keys(zip.files).filter((path) => path.startsWith(`${prefix}/charts/`) && /chart\d+\.xml$/i.test(path)),
  );
  const sections: string[] = [];
  const warnings: string[] = [];

  for (let chartIndex = 0; chartIndex < chartPaths.length; chartIndex += 1) {
    const path = chartPaths[chartIndex];
    if (!path) continue;
    const source = await zip.file(path)?.async('string');
    if (!source) continue;
    const document = parseXml(source);
    const title = firstLocal(document, 'title');
    const titleText = title ? textOf(title, 't').trim() : '';
    const series = localElements(document, 'ser');
    const chartParts: string[] = [`### ${titleText || `Chart ${chartIndex + 1}`}`];

    if (!series.length) {
      warnings.push(`${path} contains a chart without cached series data; its visual rendering cannot be reconstructed in a static browser.`);
      chartParts.push(`> Chart definition preserved in the source file, but no cached data were available.`);
    }

    for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
      const item = series[seriesIndex];
      if (!item) continue;
      const name = referenceValues(item, ['tx'])[0] || `Series ${seriesIndex + 1}`;
      const categories = referenceValues(item, ['cat', 'xVal']);
      const values = referenceValues(item, ['val', 'yVal', 'bubbleSize']);
      const length = Math.max(categories.length, values.length);
      if (!length) continue;
      const rows: string[][] = [['Category', name]];
      for (let index = 0; index < length; index += 1) {
        rows.push([categories[index] ?? String(index + 1), values[index] ?? '']);
      }
      chartParts.push(markdownTable(rows));
    }
    sections.push(chartParts.join('\n\n'));
  }

  return {
    count: chartPaths.length,
    markdown: sections.length ? normalizeMarkdown(`## Embedded chart data\n\n${sections.join('\n\n')}`) : '',
    warnings,
  };
}
