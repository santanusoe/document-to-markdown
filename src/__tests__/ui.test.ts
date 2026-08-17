import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
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
  it('converts the built-in semantic sample and exposes a direct Markdown download', async () => {
    const sample = document.querySelector<HTMLButtonElement>('[data-sample]');
    expect(sample).not.toBeNull();
    sample?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.success-kicker')?.textContent).toContain('Conversion complete');
    }, { timeout: 5_000 });
    const sourceTab = document.querySelector<HTMLButtonElement>('[data-tab="markdown"]');
    sourceTab?.click();
    const source = document.querySelector<HTMLTextAreaElement>('[data-source]');
    expect(source?.value).toContain('# Convergence certificate');
    expect(source?.value).toContain('| Method | Rate | Oracle calls |');
    expect(document.querySelector('[data-download-md]')).not.toBeNull();
    expect(document.querySelectorAll('.metric-grid .metric')).toHaveLength(4);
  });
});
