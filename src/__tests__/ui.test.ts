import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.setItem('fidelitymd-theme', 'dark');
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => undefined });
  if (!Blob.prototype.arrayBuffer) {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      value(this: Blob): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(this);
        });
      },
    });
  }
  await import('../main');
});

describe('Converter interface', () => {
  it('changes theme only from the dedicated theme button', () => {
    expect(document.documentElement.dataset.theme).toBe('dark');
    document.querySelector('main')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    const themeButton = document.querySelector<HTMLButtonElement>('button[data-theme-toggle]');
    expect(themeButton?.getAttribute('aria-pressed')).toBe('true');
    themeButton?.click();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(themeButton?.getAttribute('aria-pressed')).toBe('false');
  });

  it('converts the built-in semantic sample and exposes a direct Markdown download', async () => {
    expect(document.body.textContent).not.toContain('No API keys');
    expect(document.body.textContent).not.toContain('No file uploads');
    expect(document.body.textContent).not.toContain('✓ Open source');
    expect(document.querySelector('[data-open-history]')).not.toBeNull();
    const sample = document.querySelector<HTMLButtonElement>('[data-sample]');
    expect(sample).not.toBeNull();
    sample?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.success-kicker')?.textContent).toContain('Conversion complete');
    }, { timeout: 5_000 });
    expect(document.querySelector('[data-preview] table')).not.toBeNull();
    expect(document.querySelector('[data-preview] .katex-display')).not.toBeNull();
    expect(document.querySelector('[data-preview] .katex-error')).toBeNull();
    const sourceTab = document.querySelector<HTMLButtonElement>('[data-tab="markdown"]');
    sourceTab?.click();
    const source = document.querySelector<HTMLTextAreaElement>('[data-source]');
    expect(source?.value).toContain('# Convergence certificate');
    expect(source?.value).toContain('| Method | Rate | Oracle calls |');
    expect(document.querySelector('[data-download-md]')).not.toBeNull();
    expect(document.querySelectorAll('.metric-grid .metric')).toHaveLength(4);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.history-card')).toHaveLength(1);
    });
    expect(document.querySelector('.history-card')?.textContent).toContain('structured-sample.html');
    expect(document.querySelector('.history-section')?.textContent).toContain('Each visitor sees only');
  });
});
