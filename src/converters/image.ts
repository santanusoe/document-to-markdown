import type { Asset, ConverterContext, Metric } from '../types';
import { normalizeMarkdown } from '../utils/markdown';

interface ImageConversion {
  markdown: string;
  assets: Asset[];
  metrics: Metric[];
  warnings: string[];
  sourceType: string;
}

export async function convertImage(
  file: File,
  _buffer: ArrayBuffer,
  context: ConverterContext,
): Promise<ImageConversion> {
  const assetName = `source-image.${file.name.split('.').pop()?.toLowerCase() || 'png'}`;
  const assets: Asset[] = [{ name: assetName, blob: file, kind: 'image', source: file.name }];
  let text = '';
  let confidence = 0;
  const warnings: string[] = [];
  if (context.options.runOcr) {
    context.onProgress({ phase: 'Loading local OCR', percent: 20, detail: 'Downloading the recognition model; the image is never uploaded' });
    const { createWorker, OEM } = await import('tesseract.js');
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      logger: (message) => {
        if (message.status === 'recognizing text') {
          context.onProgress({ phase: 'Recognising image text', percent: 30 + Math.round((message.progress ?? 0) * 58), detail: `${Math.round((message.progress ?? 0) * 100)}%` });
        }
      },
    });
    try {
      const result = await worker.recognize(file);
      text = result.data.text.trim();
      confidence = result.data.confidence;
    } finally {
      await worker.terminate();
    }
    warnings.push('OCR cannot reliably reconstruct mathematical notation, reading order, or tables from arbitrary pixels. Verify the extracted text against the linked source image.');
  } else {
    warnings.push('OCR was disabled, so the image is preserved as a linked Markdown asset without guessed text.');
  }
  const markdown = normalizeMarkdown([
    `# ${file.name.replace(/\.[^.]+$/, '')}`,
    `![Source image](assets/${assetName})`,
    text ? `## Recognised text\n\n${text}` : '',
  ].filter(Boolean).join('\n\n'));
  const metrics: Metric[] = [
    { label: 'Source', value: 'Pixel image', level: 'high', detail: 'The original image is retained byte-for-byte in the output package.' },
    { label: 'Text', value: text ? `${confidence.toFixed(0)}% OCR confidence` : 'Not extracted', level: text && confidence >= 85 ? 'medium' : 'review', detail: 'OCR confidence is an engine estimate, not a guarantee of character-level accuracy.' },
    { label: 'Tables', value: 'Visual only', level: 'review', detail: 'Arbitrary pixel tables cannot be reconstructed safely without a specialised vision model.' },
    { label: 'Equations', value: 'Visual only', level: 'review', detail: 'The original pixels are authoritative; equations are not fabricated as LaTeX.' },
  ];
  return { markdown, assets, metrics, warnings, sourceType: file.type || 'Image' };
}
