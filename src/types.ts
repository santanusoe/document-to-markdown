export type FidelityLevel = 'high' | 'medium' | 'review';

export interface Asset {
  name: string;
  blob: Blob;
  kind: 'image' | 'attachment';
  source?: string;
}

export interface Metric {
  label: string;
  value: string;
  level: FidelityLevel;
  detail: string;
}

export interface ConversionOptions {
  dehyphenate: boolean;
  keepPageMarkers: boolean;
  preserveVisualPages: boolean;
  runOcr: boolean;
  includeMetadata: boolean;
  tableStyle: 'gfm' | 'html';
}

export interface ConversionProgress {
  phase: string;
  percent: number;
  detail?: string;
}

export interface ConversionResult {
  id: string;
  sourceName: string;
  sourceType: string;
  markdown: string;
  assets: Asset[];
  metrics: Metric[];
  warnings: string[];
  elapsedMs: number;
  pageCount?: number;
  wordCount: number;
}

export type ProgressCallback = (progress: ConversionProgress) => void;

export interface ConverterContext {
  options: ConversionOptions;
  onProgress: ProgressCallback;
}

export const DEFAULT_OPTIONS: ConversionOptions = {
  dehyphenate: true,
  keepPageMarkers: false,
  preserveVisualPages: true,
  runOcr: true,
  includeMetadata: true,
  tableStyle: 'gfm',
};
