import './style.css';
import 'katex/dist/katex.min.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/dm-mono/latin-400.css';
import '@fontsource/dm-mono/latin-500.css';
import '@fontsource/playfair-display/latin-600-italic.css';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import renderMathInElement from 'katex/contrib/auto-render';
import { ACCEPTED_EXTENSIONS, convertFile } from './converter';
import { clearHistory, deleteHistory, loadHistory, saveHistory, type HistoryEntry } from './history';
import { DEFAULT_OPTIONS, type ConversionOptions, type ConversionProgress, type ConversionResult } from './types';
import { downloadBlob, packageAll, packageResult, stemOf } from './utils/files';

interface QueueItem {
  id: string;
  file: File;
  status: 'waiting' | 'converting' | 'done' | 'error';
  progress: ConversionProgress;
  result?: ConversionResult;
  error?: string;
}

const state: {
  queue: QueueItem[];
  selectedId?: string;
  tab: 'preview' | 'markdown';
  busy: boolean;
  previewUrls: string[];
  history: HistoryEntry[];
  historyReady: boolean;
} = {
  queue: [],
  tab: 'preview',
  busy: false,
  previewUrls: [],
  history: [],
  historyReady: false,
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Application root not found.');

app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="FidelityMD home">
      <span class="brand-mark" aria-hidden="true">M<span>↓</span></span>
      <span><strong>FidelityMD</strong><small>local document converter</small></span>
    </a>
    <nav aria-label="Primary navigation">
      <button class="nav-link" type="button" data-open-formats>Formats</button>
      <button class="nav-link" type="button" data-open-history>History</button>
      <a class="nav-link" href="https://github.com/santanusoe/document-to-markdown" target="_blank" rel="noreferrer">Source</a>
      <button class="theme-button" type="button" data-theme aria-label="Switch colour theme"><span aria-hidden="true">◐</span></button>
    </nav>
  </header>

  <main>
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="eyebrow"><span></span> Document intelligence, on device</div>
        <h1 id="hero-title">Extract the document.<br><em>Keep the meaning.</em></h1>
        <p>High-fidelity Markdown reconstruction for dense PDFs, Office files, tables, equations and visual research. Review the evidence behind every conversion.</p>
        <div class="hero-actions">
          <a class="primary-button hero-button" href="#workspace">Convert a document <span aria-hidden="true">↓</span></a>
          <button class="secondary-button hero-button" type="button" data-open-formats>Explore formats</button>
        </div>
        <p class="hero-footnote"><span aria-hidden="true"></span> Processing and personal history stay inside this browser.</p>
      </div>
      <div class="hero-stage" aria-hidden="true">
        <div class="source-sheet">
          <div class="sheet-bar"><span>source.pdf</span><i>14 pages</i></div>
          <b></b><b></b><b class="short"></b>
          <div class="mini-table"><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="mini-equation">∑ xᵢ → <strong>f(x)</strong></div>
          <span class="figure-chip">FIG. 03</span>
        </div>
        <div class="conversion-rail"><span>LOCAL</span><i></i><b>↓</b><i></i></div>
        <div class="markdown-sheet">
          <div class="sheet-bar"><span>output.md</span><i>ready</i></div>
          <code># Findings</code><code>## Method</code>
          <b></b><b class="short"></b>
          <div class="markdown-table">| Method | Rate |<br>| — | — |<br>| F-B | O(1/N) |</div>
          <div class="quality-stamp"><span>96</span><small>STRUCTURE<br>SIGNALS</small></div>
        </div>
      </div>
    </section>

    <section class="workspace" id="workspace" aria-label="Document converter">
      <div class="upload-panel" data-drop-zone>
        <div class="upload-orbit" aria-hidden="true"><span>MD</span></div>
        <h2>Drop your documents here</h2>
        <p>or choose files from your device</p>
        <label class="primary-button" for="file-input"><span>＋</span> Choose files</label>
        <input id="file-input" type="file" multiple accept=".${ACCEPTED_EXTENSIONS.join(',.')}" />
        <p class="format-line">PDF · DOCX · PPTX · XLSX · ODT · EPUB · images · HTML · LaTeX · and more</p>
        <button class="sample-button" type="button" data-sample>Try a structured sample</button>
      </div>

      <aside class="settings-panel" aria-label="Conversion settings">
        <div class="panel-heading">
          <div><span class="step-number">01</span><h2>Conversion policy</h2></div>
          <span class="local-pill">On device</span>
        </div>
        <label class="setting-row">
          <span><strong>Preserve visual pages</strong><small>Keep graph- and diagram-heavy PDF pages as linked PNGs.</small></span>
          <input type="checkbox" data-option="preserveVisualPages" checked /><i></i>
        </label>
        <label class="setting-row">
          <span><strong>Local OCR fallback</strong><small>Recognise scanned pages and images. The language model downloads once.</small></span>
          <input type="checkbox" data-option="runOcr" checked /><i></i>
        </label>
        <label class="setting-row">
          <span><strong>Repair line-wrap hyphens</strong><small>Join words split mechanically at PDF line endings.</small></span>
          <input type="checkbox" data-option="dehyphenate" checked /><i></i>
        </label>
        <label class="setting-row">
          <span><strong>Keep page markers</strong><small>Add invisible comments marking each source PDF page.</small></span>
          <input type="checkbox" data-option="keepPageMarkers" /><i></i>
        </label>
        <label class="setting-row">
          <span><strong>Include document metadata</strong><small>Retain title, author, subject and dates when available.</small></span>
          <input type="checkbox" data-option="includeMetadata" checked /><i></i>
        </label>
        <div class="precision-note">
          <span aria-hidden="true">◎</span>
          <p><strong>A fidelity report, not a fake guarantee.</strong> Every result labels which structures were read natively, inferred geometrically, or produced by OCR.</p>
        </div>
      </aside>
    </section>

    <section class="results-shell is-hidden" data-results aria-live="polite">
      <div class="results-topbar">
        <div><span class="step-number">02</span><div><h2>Conversion workspace</h2><p data-summary></p></div></div>
        <div class="top-actions">
          <button class="secondary-button" type="button" data-add-more>＋ Add files</button>
          <button class="primary-button compact" type="button" data-download-all>Download all</button>
        </div>
      </div>
      <div class="result-grid">
        <aside class="file-rail" aria-label="Conversion queue">
          <div class="rail-label">Files</div>
          <div data-file-list></div>
          <button class="clear-button" type="button" data-clear>Clear completed</button>
        </aside>
        <article class="output-panel" data-output></article>
      </div>
    </section>

    <section class="history-section" id="history" aria-labelledby="history-title">
      <div class="history-heading">
        <div class="section-title-lockup"><span class="step-number">03</span><div><div class="eyebrow"><span></span> Private, per-browser archive</div><h2 id="history-title">Your conversion history.</h2><p>Each visitor sees only the conversions saved in their own browser profile.</p></div></div>
        <button class="secondary-button" type="button" data-clear-history>Clear history</button>
      </div>
      <div class="history-list" data-history-list aria-live="polite">
        <div class="history-loading"><span></span> Loading local history…</div>
      </div>
    </section>

    <section class="method-section" aria-labelledby="method-title">
      <div class="method-heading">
        <span class="step-number">04</span>
        <div><div class="eyebrow"><span></span> Fidelity by source structure</div><h2 id="method-title">The right method for each format.</h2></div>
      </div>
      <div class="method-grid">
        <article><span class="method-icon">¶</span><h3>Digital documents</h3><p>DOCX, PPTX, ODT and EPUB are read from their semantic XML—not flattened into screenshots.</p><small>Headings · lists · links · footnotes · media</small></article>
        <article><span class="method-icon">▦</span><h3>Tables and workbooks</h3><p>Native cells, formulae, merges and cached chart series are reconstructed deterministically.</p><small>GFM tables · HTML spans · formula comments</small></article>
        <article><span class="method-icon">∑</span><h3>Mathematics</h3><p>Office Math becomes LaTeX structurally. PDF formulae are flagged for review and paired with the source visual.</p><small>OMML → LaTeX · MathML retained</small></article>
        <article><span class="method-icon">◫</span><h3>Scans and figures</h3><p>OCR runs locally, while graphs and diagrams remain linked to authoritative visual assets.</p><small>Local OCR · page visual layer · no uploads</small></article>
      </div>
    </section>
  </main>

  <footer>
    <div class="brand footer-brand"><span class="brand-mark">M<span>↓</span></span><span><strong>FidelityMD</strong><small>built for documents that matter</small></span></div>
    <p>Files never leave your browser. Review critical equations and inferred PDF tables before publication.</p>
    <a href="https://github.com/santanusoe/document-to-markdown" target="_blank" rel="noreferrer">GitHub ↗</a>
  </footer>

  <dialog class="formats-dialog" data-formats-dialog>
    <button class="dialog-close" type="button" data-close-formats aria-label="Close">×</button>
    <div class="eyebrow"><span></span> Supported inputs</div>
    <h2>Format coverage</h2>
    <p>“Any file” is not a technically meaningful promise. FidelityMD supports these formats explicitly and refuses binary guesswork when a format cannot be decoded safely.</p>
    <div class="format-grid">
      <div><strong>Documents</strong><span>PDF, DOCX, ODT, RTF, EPUB, HTML, TXT, Markdown</span></div>
      <div><strong>Data</strong><span>XLSX, XLS, XLSB, ODS, CSV, TSV, JSON, XML</span></div>
      <div><strong>Presentations</strong><span>PPTX, plus Apple Quick Look previews when embedded</span></div>
      <div><strong>Technical</strong><span>LaTeX, Jupyter notebooks, YAML and common source-code files</span></div>
      <div><strong>Images</strong><span>PNG, JPEG, GIF, WebP, BMP and TIFF with optional local OCR</span></div>
      <div><strong>Legacy warning</strong><span>.doc and .ppt must first be saved as DOCX/PPTX; browsers cannot parse their proprietary binary object model reliably.</span></div>
    </div>
  </dialog>

  <div class="toast" role="status" data-toast></div>
`;

const input = document.querySelector<HTMLInputElement>('#file-input')!;
const dropZone = document.querySelector<HTMLElement>('[data-drop-zone]')!;
const resultsShell = document.querySelector<HTMLElement>('[data-results]')!;
const fileList = document.querySelector<HTMLElement>('[data-file-list]')!;
const output = document.querySelector<HTMLElement>('[data-output]')!;
const summary = document.querySelector<HTMLElement>('[data-summary]')!;
const toast = document.querySelector<HTMLElement>('[data-toast]')!;
const historyList = document.querySelector<HTMLElement>('[data-history-list]')!;
if (!input || !dropZone || !resultsShell || !fileList || !output || !summary || !toast || !historyList) throw new Error('Required interface elements are missing.');

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatHistoryDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(timestamp));
}

function renderHistory(): void {
  if (!state.historyReady) {
    historyList.innerHTML = '<div class="history-loading"><span></span> Loading local history…</div>';
    return;
  }
  if (!state.history.length) {
    historyList.innerHTML = `<div class="history-empty"><span aria-hidden="true">↺</span><div><h3>No conversions saved yet</h3><p>Completed files will appear here automatically and remain visible only in this browser.</p></div><a href="#workspace">Start a conversion</a></div>`;
    return;
  }
  historyList.innerHTML = state.history.map((entry) => {
    const reviewCount = entry.metrics.filter((metric) => metric.level === 'review').length + entry.warnings.length;
    const nativeCount = entry.metrics.filter((metric) => metric.level === 'high').length;
    const pageText = entry.pageCount ? `${entry.pageCount} page${entry.pageCount === 1 ? '' : 's'} · ` : '';
    return `<article class="history-card">
      <button class="history-open" type="button" data-history-open="${entry.id}" aria-label="Open ${escapeHtml(entry.sourceName)} from history">
        <span class="history-icon">${iconFor(entry.sourceName)}</span>
        <span class="history-meta"><small>${escapeHtml(entry.sourceType)} · ${formatHistoryDate(entry.createdAt)}</small><strong title="${escapeHtml(entry.sourceName)}">${escapeHtml(entry.sourceName)}</strong><i>${pageText}${entry.wordCount.toLocaleString()} words · ${(entry.elapsedMs / 1000).toFixed(1)} s</i></span>
      </button>
      <div class="history-signals" aria-label="Conversion signals"><span>${nativeCount} native signals</span><span class="${reviewCount ? 'needs-review' : ''}">${reviewCount ? `${reviewCount} review notes` : 'No review flags'}</span>${entry.assetsStored && entry.assets.length ? `<span>${entry.assets.length} assets saved</span>` : ''}</div>
      <div class="history-actions"><button type="button" data-history-download="${entry.id}">Download .md</button><button type="button" data-history-delete="${entry.id}" aria-label="Delete ${escapeHtml(entry.sourceName)} from history">Delete</button></div>
    </article>`;
  }).join('');

  historyList.querySelectorAll<HTMLButtonElement>('[data-history-open]').forEach((button) => button.addEventListener('click', () => {
    const entry = state.history.find((candidate) => candidate.id === button.dataset.historyOpen);
    if (!entry) return;
    const existing = state.queue.find((item) => item.result?.id === entry.id);
    if (existing) {
      state.selectedId = existing.id;
    } else {
      const file = new File([entry.markdown], entry.sourceName, { type: 'text/markdown', lastModified: entry.createdAt });
      const item: QueueItem = { id: crypto.randomUUID(), file, status: 'done', progress: { phase: 'Complete', percent: 100 }, result: entry };
      state.queue.unshift(item);
      state.selectedId = item.id;
    }
    renderQueue();
    renderOutput();
    resultsShell.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  historyList.querySelectorAll<HTMLButtonElement>('[data-history-download]').forEach((button) => button.addEventListener('click', () => {
    const entry = state.history.find((candidate) => candidate.id === button.dataset.historyDownload);
    if (entry) downloadBlob(new Blob([entry.markdown], { type: 'text/markdown;charset=utf-8' }), `${stemOf(entry.sourceName)}.md`);
  }));
  historyList.querySelectorAll<HTMLButtonElement>('[data-history-delete]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.historyDelete;
    if (!id) return;
    await deleteHistory(id);
    state.history = state.history.filter((entry) => entry.id !== id);
    renderHistory();
    showToast('History entry deleted');
  }));
}

async function refreshHistory(): Promise<void> {
  state.history = await loadHistory();
  state.historyReady = true;
  renderHistory();
}

function iconFor(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'PDF';
  if (['docx', 'odt', 'rtf'].includes(extension ?? '')) return 'DOC';
  if (['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(extension ?? '')) return 'XLS';
  if (['pptx', 'key'].includes(extension ?? '')) return 'PPT';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff'].includes(extension ?? '')) return 'IMG';
  return 'TXT';
}

function options(): ConversionOptions {
  const value = { ...DEFAULT_OPTIONS };
  document.querySelectorAll<HTMLInputElement>('[data-option]').forEach((control) => {
    const key = control.dataset.option as keyof ConversionOptions;
    if (key !== 'tableStyle') (value[key] as boolean) = control.checked;
  });
  return value;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2_600);
}

function renderQueue(): void {
  resultsShell.classList.toggle('is-hidden', state.queue.length === 0);
  const done = state.queue.filter((item) => item.status === 'done').length;
  const errors = state.queue.filter((item) => item.status === 'error').length;
  summary.textContent = `${done} complete${errors ? ` · ${errors} needs attention` : ''} · ${state.queue.length} total`;
  fileList.innerHTML = state.queue.map((item) => {
    const active = item.id === state.selectedId ? ' active' : '';
    const status = item.status === 'done' ? 'Ready' : item.status === 'error' ? 'Error' : item.status === 'converting' ? `${item.progress.percent}%` : 'Waiting';
    return `<button class="file-item${active}" type="button" data-file-id="${item.id}">
      <span class="file-icon ${item.status}">${iconFor(item.file.name)}</span>
      <span class="file-meta"><strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong><small>${formatBytes(item.file.size)} · ${status}</small>
      ${item.status === 'converting' ? `<i class="mini-progress"><b style="width:${item.progress.percent}%"></b></i>` : ''}</span>
      <span class="file-status ${item.status}" aria-label="${status}">${item.status === 'done' ? '✓' : item.status === 'error' ? '!' : '›'}</span>
    </button>`;
  }).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-file-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedId = button.dataset.fileId;
      renderQueue();
      renderOutput();
    });
  });
}

function revokePreviewUrls(): void {
  state.previewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.previewUrls = [];
}

function fidelityBadge(level: string): string {
  return level === 'high' ? 'Native/high' : level === 'medium' ? 'Inferred' : 'Review';
}

function renderMarkdownPreview(result: ConversionResult): void {
  const preview = output.querySelector<HTMLElement>('[data-preview]');
  if (!preview) return;
  revokePreviewUrls();
  const raw = marked.parse(result.markdown, { gfm: true, breaks: false }) as string;
  preview.innerHTML = DOMPurify.sanitize(raw, { ADD_TAGS: ['math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac'], ADD_ATTR: ['display', 'rowspan', 'colspan'] });
  preview.querySelectorAll<HTMLImageElement>('img[src^="assets/"]').forEach((image) => {
    const name = image.getAttribute('src')?.replace(/^assets\//, '');
    const asset = result.assets.find((candidate) => candidate.name === name);
    if (!asset) return;
    const url = URL.createObjectURL(asset.blob);
    state.previewUrls.push(url);
    image.src = url;
  });
  try {
    renderMathInElement(preview, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
      strict: false,
    });
  } catch {
    // The source remains visible when a malformed equation cannot be rendered.
  }
}

function renderOutput(): void {
  const item = state.queue.find((candidate) => candidate.id === state.selectedId) ?? state.queue[0];
  if (!item) {
    output.innerHTML = '<div class="empty-output"><span>↓</span><p>Add a document to begin.</p></div>';
    return;
  }
  if (item.status === 'waiting' || item.status === 'converting') {
    output.innerHTML = `<div class="conversion-state">
      <div class="conversion-spinner"><span>${item.progress.percent}</span></div>
      <div><div class="eyebrow"><span></span> Processing locally</div><h3>${escapeHtml(item.progress.phase)}</h3><p>${escapeHtml(item.progress.detail ?? item.file.name)}</p></div>
      <div class="large-progress"><span style="width:${item.progress.percent}%"></span></div>
      <small>No document bytes are sent over the network.</small>
    </div>`;
    return;
  }
  if (item.status === 'error') {
    output.innerHTML = `<div class="error-state"><span>!</span><div><h3>This file could not be converted safely.</h3><p>${escapeHtml(item.error ?? 'Unknown conversion error.')}</p><button class="secondary-button" type="button" data-remove-current>Remove file</button></div></div>`;
    output.querySelector('[data-remove-current]')?.addEventListener('click', () => removeItem(item.id));
    return;
  }
  const result = item.result;
  if (!result) return;
  output.innerHTML = `
    <div class="output-header">
      <div><span class="success-kicker">✓ Conversion complete</span><h3>${escapeHtml(result.sourceName)}</h3><p>${result.sourceType} · ${result.wordCount.toLocaleString()} words · ${result.assets.length} assets · ${(result.elapsedMs / 1000).toFixed(1)} s</p></div>
      <div class="output-actions"><button class="secondary-button" type="button" data-copy>Copy</button><button class="secondary-button" type="button" data-download-md>Download .md</button><button class="primary-button compact" type="button" data-download>Package + assets</button></div>
    </div>
    <section class="fidelity-report" aria-labelledby="report-${result.id}">
      <div class="report-title"><div><span class="step-number">F</span><div><h4 id="report-${result.id}">Fidelity report</h4><p>Evidence behind this conversion</p></div></div><span class="report-policy">No universal “99%” claim</span></div>
      <div class="metric-grid">${result.metrics.map((metric) => `<article class="metric ${metric.level}"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong><i>${fidelityBadge(metric.level)}</i><p>${escapeHtml(metric.detail)}</p></article>`).join('')}</div>
      ${result.warnings.length ? `<details class="warnings"><summary>${result.warnings.length} review note${result.warnings.length === 1 ? '' : 's'}</summary><ul>${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></details>` : ''}
    </section>
    <div class="editor-bar">
      <div role="tablist" aria-label="Output view"><button type="button" role="tab" data-tab="preview" aria-selected="${state.tab === 'preview'}" class="${state.tab === 'preview' ? 'active' : ''}">Rendered preview</button><button type="button" role="tab" data-tab="markdown" aria-selected="${state.tab === 'markdown'}" class="${state.tab === 'markdown' ? 'active' : ''}">Markdown source</button></div>
      <span>${result.markdown.length.toLocaleString()} characters</span>
    </div>
    <div class="editor-body">
      <div class="markdown-preview ${state.tab === 'preview' ? '' : 'is-hidden'}" data-preview></div>
      <textarea class="markdown-source ${state.tab === 'markdown' ? '' : 'is-hidden'}" data-source readonly spellcheck="false" aria-label="Converted Markdown source"></textarea>
    </div>`;
  const source = output.querySelector<HTMLTextAreaElement>('[data-source]');
  if (source) source.value = result.markdown;
  if (state.tab === 'preview') renderMarkdownPreview(result);
  output.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    state.tab = button.dataset.tab === 'markdown' ? 'markdown' : 'preview';
    renderOutput();
  }));
  output.querySelector('[data-copy]')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(result.markdown);
    showToast('Markdown copied to clipboard');
  });
  output.querySelector('[data-download-md]')?.addEventListener('click', () => {
    downloadBlob(new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' }), `${stemOf(result.sourceName)}.md`);
  });
  output.querySelector('[data-download]')?.addEventListener('click', async () => {
    showToast('Building download package…');
    downloadBlob(await packageResult(result), `${stemOf(result.sourceName)}-markdown.zip`);
  });
}

function removeItem(id: string): void {
  state.queue = state.queue.filter((item) => item.id !== id);
  state.selectedId = state.queue[0]?.id;
  renderQueue();
  renderOutput();
}

async function processQueue(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  while (true) {
    const item = state.queue.find((candidate) => candidate.status === 'waiting');
    if (!item) break;
    item.status = 'converting';
    state.selectedId ??= item.id;
    renderQueue();
    renderOutput();
    try {
      item.result = await convertFile(item.file, options(), (progress) => {
        item.progress = progress;
        renderQueue();
        if (state.selectedId === item.id) renderOutput();
      });
      item.status = 'done';
      item.progress = { phase: 'Complete', percent: 100 };
      await saveHistory(item.result);
      await refreshHistory();
    } catch (error) {
      item.status = 'error';
      item.error = error instanceof Error ? error.message : String(error);
    }
    renderQueue();
    renderOutput();
  }
  state.busy = false;
}

function addFiles(files: File[]): void {
  const unique = files.filter((file) => !state.queue.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified));
  if (!unique.length) {
    showToast('Those files are already in the queue');
    return;
  }
  for (const file of unique) {
    state.queue.push({ id: crypto.randomUUID(), file, status: 'waiting', progress: { phase: 'Waiting', percent: 0 } });
  }
  state.selectedId ??= state.queue[0]?.id;
  renderQueue();
  renderOutput();
  resultsShell.scrollIntoView({ behavior: 'smooth', block: 'start' });
  void processQueue();
}

input.addEventListener('change', () => {
  addFiles(Array.from(input.files ?? []));
  input.value = '';
});

['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop', (event) => addFiles(Array.from(event.dataTransfer?.files ?? [])));

document.querySelector('[data-add-more]')?.addEventListener('click', () => input.click());
document.querySelector('[data-download-all]')?.addEventListener('click', async () => {
  const results = state.queue.flatMap((item) => item.result ? [item.result] : []);
  if (!results.length) return showToast('No completed conversions yet');
  downloadBlob(await packageAll(results), 'fidelitymd-conversions.zip');
});
document.querySelector('[data-clear]')?.addEventListener('click', () => {
  state.queue = state.queue.filter((item) => item.status === 'converting' || item.status === 'waiting');
  state.selectedId = state.queue[0]?.id;
  renderQueue();
  renderOutput();
});

document.querySelector('[data-sample]')?.addEventListener('click', () => {
  const sample = new File([`<!doctype html><html><body><h1>Convergence certificate</h1><p>Consider the monotone inclusion <strong>0 ∈ A(x) + B(x)</strong>.</p><h2>Assumptions</h2><ul><li>A is maximally monotone.</li><li>B is L-Lipschitz continuous.</li></ul><table><thead><tr><th>Method</th><th>Rate</th><th>Oracle calls</th></tr></thead><tbody><tr><td>Forward–backward</td><td>O(1/N)</td><td>1</td></tr><tr><td>Accelerated</td><td>O(1/N²)</td><td>1</td></tr></tbody></table><p>$$\\|x^{k+1}-x^\\star\\|^2 \\leq \\|x^k-x^\\star\\|^2 - \\delta_k.$$</p></body></html>`], 'structured-sample.html', { type: 'text/html' });
  addFiles([sample]);
});

const dialog = document.querySelector<HTMLDialogElement>('[data-formats-dialog]');
document.querySelectorAll('[data-open-formats]').forEach((button) => button.addEventListener('click', () => dialog?.showModal()));
document.querySelector('[data-close-formats]')?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

const storedTheme = localStorage.getItem('fidelitymd-theme');
if (storedTheme === 'dark') document.documentElement.dataset.theme = 'dark';
document.querySelector('[data-theme]')?.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('fidelitymd-theme', dark ? 'dark' : 'light');
});

document.querySelector('[data-open-history]')?.addEventListener('click', () => {
  document.querySelector('#history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.querySelector('[data-clear-history]')?.addEventListener('click', async () => {
  if (!state.history.length) return showToast('History is already empty');
  if (!window.confirm('Delete every conversion saved in this browser? This cannot be undone.')) return;
  await clearHistory();
  state.history = [];
  renderHistory();
  showToast('Local history cleared');
});

renderQueue();
renderOutput();
renderHistory();
void refreshHistory();
