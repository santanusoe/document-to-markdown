import type { ConversionResult } from './types';

export interface HistoryEntry extends ConversionResult {
  createdAt: number;
  assetsStored: boolean;
}

const DATABASE_NAME = 'fidelitymd-history';
const STORE_NAME = 'conversions';
const DATABASE_VERSION = 1;
const LOCAL_STORAGE_KEY = 'fidelitymd-history-fallback';
const MAX_ENTRIES = 24;
const MAX_PERSISTED_ASSET_BYTES = 24 * 1024 * 1024;
const MAX_FALLBACK_MARKDOWN_CHARACTERS = 750_000;

let databasePromise: Promise<IDBDatabase | undefined> | undefined;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser history storage failed.'));
  });
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (databasePromise) return databasePromise;
  if (!('indexedDB' in globalThis)) return Promise.resolve(undefined);
  databasePromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      request.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return databasePromise;
}

function historySnapshot(result: ConversionResult): HistoryEntry {
  const assetBytes = result.assets.reduce((sum, asset) => sum + asset.blob.size, 0);
  const assetsStored = assetBytes <= MAX_PERSISTED_ASSET_BYTES;
  return {
    ...result,
    metrics: result.metrics.map((metric) => ({ ...metric })),
    warnings: [
      ...result.warnings,
      ...(!assetsStored && result.assets.length
        ? ['Visual assets were omitted from this history snapshot to protect browser storage. The original download from the conversion workspace remains complete.']
        : []),
    ],
    assets: assetsStored ? result.assets.map((asset) => ({ ...asset })) : [],
    createdAt: Date.now(),
    assetsStored,
  };
}

function localEntries(): HistoryEntry[] {
  try {
    const value = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalEntries(entries: HistoryEntry[]): void {
  try {
    const compact = entries.slice(0, MAX_ENTRIES).map((entry) => ({
      ...entry,
      markdown: entry.markdown.slice(0, MAX_FALLBACK_MARKDOWN_CHARACTERS),
      assets: [],
      assetsStored: false,
    }));
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // Private browsing and strict storage policies may disable persistence.
  }
}

async function pruneDatabase(database: IDBDatabase): Promise<void> {
  const entries = await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()) as HistoryEntry[];
  const stale = entries.sort((left, right) => right.createdAt - left.createdAt).slice(MAX_ENTRIES);
  if (!stale.length) return;
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  await Promise.all(stale.map((entry) => requestResult(store.delete(entry.id))));
}

export async function saveHistory(result: ConversionResult): Promise<HistoryEntry> {
  const entry = historySnapshot(result);
  const database = await openDatabase();
  if (database) {
    try {
      await requestResult(database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(entry));
      await pruneDatabase(database);
      return entry;
    } catch {
      // Fall through to a compact localStorage snapshot when IndexedDB quota is unavailable.
    }
  }
  const entries = [entry, ...localEntries().filter((candidate) => candidate.id !== entry.id)];
  writeLocalEntries(entries);
  return { ...entry, assets: [], assetsStored: false };
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const fallback = localEntries();
  const database = await openDatabase();
  if (database) {
    try {
      const entries = await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()) as HistoryEntry[];
      const merged = new Map<string, HistoryEntry>();
      for (const entry of [...fallback, ...entries]) merged.set(entry.id, entry);
      return Array.from(merged.values()).sort((left, right) => right.createdAt - left.createdAt).slice(0, MAX_ENTRIES);
    } catch {
      // Use the compact fallback below.
    }
  }
  return fallback.sort((left, right) => right.createdAt - left.createdAt).slice(0, MAX_ENTRIES);
}

export async function deleteHistory(id: string): Promise<void> {
  const database = await openDatabase();
  if (database) {
    try {
      await requestResult(database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id));
    } catch {
      // The local fallback is still cleaned below.
    }
  }
  writeLocalEntries(localEntries().filter((entry) => entry.id !== id));
}

export async function clearHistory(): Promise<void> {
  const database = await openDatabase();
  if (database) {
    try {
      await requestResult(database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear());
    } catch {
      // The local fallback is still cleaned below.
    }
  }
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // Storage can be disabled by the browser.
  }
}
