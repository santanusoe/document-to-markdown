import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import type { Asset, ConverterContext, Metric } from '../types';
import { safeAssetName, uniqueAssetName } from '../utils/files';
import { escapeTableCell, markdownTable, normalizeMarkdown } from '../utils/markdown';
import { extractCharts } from '../utils/openxml';

interface SpreadsheetConversion {
  markdown: string;
  assets: Asset[];
  metrics: Metric[];
  warnings: string[];
  sourceType: string;
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
};

function formattedCell(cell: XLSX.CellObject | undefined): string {
  if (!cell) return '';
  const visible = cell.w ?? (cell.v === undefined || cell.v === null ? '' : String(cell.v));
  return cell.f ? `${visible} <!-- formula: =${cell.f.replace(/--/g, '—')} -->` : visible;
}

function sheetRows(sheet: XLSX.WorkSheet): string[][] {
  const reference = sheet['!ref'];
  if (!reference) return [];
  const range = XLSX.utils.decode_range(reference);
  const rows: string[][] = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: string[] = [];
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      row.push(formattedCell(sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })]));
    }
    while (row.length && !row.at(-1)) row.pop();
    rows.push(row);
  }
  while (rows.length && !(rows.at(-1)?.some(Boolean))) rows.pop();
  return rows;
}

function complexTable(sheet: XLSX.WorkSheet, rows: string[][]): string {
  const reference = sheet['!ref'];
  if (!reference) return '';
  const range = XLSX.utils.decode_range(reference);
  const merges = sheet['!merges'] ?? [];
  const covered = new Set<string>();
  const mergeStart = new Map<string, { rowspan: number; colspan: number }>();
  for (const merge of merges) {
    const start = `${merge.s.r}:${merge.s.c}`;
    mergeStart.set(start, { rowspan: merge.e.r - merge.s.r + 1, colspan: merge.e.c - merge.s.c + 1 });
    for (let r = merge.s.r; r <= merge.e.r; r += 1) {
      for (let c = merge.s.c; c <= merge.e.c; c += 1) if (r !== merge.s.r || c !== merge.s.c) covered.add(`${r}:${c}`);
    }
  }
  const html = ['<table>'];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    html.push('  <tr>');
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      if (covered.has(`${r}:${c}`)) continue;
      const span = mergeStart.get(`${r}:${c}`);
      const attributes = [
        span?.rowspan && span.rowspan > 1 ? ` rowspan="${span.rowspan}"` : '',
        span?.colspan && span.colspan > 1 ? ` colspan="${span.colspan}"` : '',
      ].join('');
      const value = escapeTableCell(rows[r - range.s.r]?.[c - range.s.c] ?? '');
      html.push(`    <td${attributes}>${value}</td>`);
    }
    html.push('  </tr>');
  }
  html.push('</table>');
  return html.join('\n');
}

async function extractSpreadsheetPackage(buffer: ArrayBuffer): Promise<{
  assets: Asset[];
  chartMarkdown: string;
  chartCount: number;
  warnings: string[];
}> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const assets: Asset[] = [];
    const mediaPaths = Object.keys(zip.files).filter((path) => path.startsWith('xl/media/') && !zip.files[path]?.dir);
    for (const path of mediaPaths) {
      const entry = zip.file(path);
      if (!entry) continue;
      const extension = path.split('.').pop()?.toLowerCase() ?? 'bin';
      const name = uniqueAssetName(safeAssetName(path), assets);
      assets.push({ name, blob: new Blob([await entry.async('uint8array')], { type: MEDIA_TYPES[extension] ?? 'application/octet-stream' }), kind: MEDIA_TYPES[extension] ? 'image' : 'attachment', source: path });
    }
    const charts = await extractCharts(zip, 'xl');
    return { assets, chartMarkdown: charts.markdown, chartCount: charts.count, warnings: charts.warnings };
  } catch {
    return { assets: [], chartMarkdown: '', chartCount: 0, warnings: [] };
  }
}

export async function convertSpreadsheet(
  file: File,
  buffer: ArrayBuffer,
  context: ConverterContext,
): Promise<SpreadsheetConversion> {
  context.onProgress({ phase: 'Opening workbook', percent: 18, detail: 'Reading sheets, cell types, formulas and merges' });
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellFormula: true, cellStyles: true });
  if (!workbook.SheetNames.length) throw new Error('The workbook does not contain any readable worksheets.');
  const sections: string[] = [`# ${file.name.replace(/\.[^.]+$/, '')}`];
  let totalRows = 0;
  let totalTables = 0;
  let formulaCount = 0;
  let mergeCount = 0;
  const warnings: string[] = [];

  workbook.SheetNames.forEach((name, index) => {
    context.onProgress({ phase: `Converting sheet ${index + 1} of ${workbook.SheetNames.length}`, percent: 24 + Math.round((index / workbook.SheetNames.length) * 48), detail: name });
    const sheet = workbook.Sheets[name];
    if (!sheet) return;
    const rows = sheetRows(sheet);
    totalRows += rows.length;
    formulaCount += Object.values(sheet).filter((value) => typeof value === 'object' && value !== null && 'f' in value).length;
    const merges = sheet['!merges'] ?? [];
    mergeCount += merges.length;
    sections.push(`## ${name}`);
    if (!rows.length) {
      sections.push('_Empty worksheet._');
      return;
    }
    totalTables += 1;
    sections.push(merges.length ? complexTable(sheet, rows) : markdownTable(rows));
  });

  context.onProgress({ phase: 'Recovering workbook media', percent: 78, detail: 'Images and cached chart series' });
  const packageData = await extractSpreadsheetPackage(buffer);
  sections.push(packageData.chartMarkdown);
  warnings.push(...packageData.warnings);
  if (totalRows > 20_000) warnings.push(`This workbook contains ${totalRows.toLocaleString()} rows. The complete output is retained, but browser preview performance may be slower.`);
  if (mergeCount) warnings.push(`${mergeCount} merged range${mergeCount === 1 ? ' is' : 's are'} preserved as HTML tables because pipe-table Markdown has no rowspan or colspan syntax.`);
  const hiddenSheets = workbook.Workbook?.Sheets?.filter((sheet) => sheet.Hidden && sheet.Hidden > 0).length ?? 0;
  if (hiddenSheets) warnings.push(`${hiddenSheets} hidden worksheet${hiddenSheets === 1 ? ' was' : 's were'} included deliberately so that conversion is not silently lossy.`);

  const metrics: Metric[] = [
    { label: 'Cells', value: `${totalRows.toLocaleString()} rows`, level: 'high', detail: 'Typed cell values and formatted displays are read from the workbook structure.' },
    { label: 'Tables', value: `${totalTables} sheet${totalTables === 1 ? '' : 's'}`, level: 'high', detail: 'Every non-empty worksheet becomes a complete Markdown or HTML table.' },
    { label: 'Formulas', value: `${formulaCount} preserved`, level: 'high', detail: 'Displayed results remain visible and source formulas are retained in adjacent HTML comments.' },
    { label: 'Visuals', value: `${packageData.assets.length} media · ${packageData.chartCount} charts`, level: packageData.chartCount ? 'medium' : 'high', detail: 'Embedded media are exported; cached chart data are represented as tables because Markdown has no native Office chart object.' },
  ];
  context.onProgress({ phase: 'Finalising Markdown', percent: 94, detail: `${workbook.SheetNames.length} worksheets` });
  return {
    markdown: normalizeMarkdown(sections.filter(Boolean).join('\n\n')),
    assets: packageData.assets,
    metrics,
    warnings,
    sourceType: file.name.split('.').pop()?.toUpperCase() ?? 'Spreadsheet',
  };
}
