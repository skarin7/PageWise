/**
 * CorpusStore - extension-origin IndexedDB holding cross-page reading memory.
 *
 * Runs in the background service worker. Content scripts never touch this
 * directly (their IndexedDB resolves against the host page's origin, not the
 * extension's) - they send data via chrome.runtime messages instead.
 */

import type { CorpusPage, CorpusChunk, CorpusCategory, CorpusSearchResult, CorpusTimeWindow } from '../types';
import { cosineSimilarity } from '../utils/vectorMath';

const DB_NAME = 'browseiq_corpus';
const DB_VERSION = 1;
const DEFAULT_MAX_PAGES = 2000;

export class CorpusStore {
  private static instance: CorpusStore | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private maxPages: number = DEFAULT_MAX_PAGES;

  static getInstance(): CorpusStore {
    if (!CorpusStore.instance) {
      CorpusStore.instance = new CorpusStore();
    }
    return CorpusStore.instance;
  }

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result as IDBDatabase;
        if (!db.objectStoreNames.contains('pages')) {
          const pages = db.createObjectStore('pages', { keyPath: 'url' });
          pages.createIndex('lastSeen', 'lastSeen');
          pages.createIndex('attentionScore', 'attentionScore');
          pages.createIndex('categoryId', 'categoryId');
        }
        if (!db.objectStoreNames.contains('chunks')) {
          const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
          chunks.createIndex('url', 'metadata.url');
        }
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async setMaxPages(n: number): Promise<void> {
    this.maxPages = n;
  }

  /**
   * Store or update a page and its chunks. Replaces any existing chunks for
   * that URL (content may have changed since last visit).
   */
  async storePage(page: CorpusPage, chunks: CorpusChunk[]): Promise<void> {
    const db = await this.openDB();

    await this.deleteChunksForUrl(page.url);

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['pages', 'chunks'], 'readwrite');
      tx.objectStore('pages').put(page);
      const chunkStore = tx.objectStore('chunks');
      for (const chunk of chunks) {
        chunkStore.put(chunk);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await this.enforceEviction();
  }

  async getPage(url: string): Promise<CorpusPage | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pages', 'readonly');
      const req = tx.objectStore('pages').get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllPages(): Promise<CorpusPage[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pages', 'readonly');
      const req = tx.objectStore('pages').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async listPages(window: CorpusTimeWindow = 'all', categoryId?: string): Promise<CorpusPage[]> {
    const all = await this.getAllPages();
    const cutoff = windowCutoff(window);
    return all
      .filter(p => p.lastSeen >= cutoff)
      .filter(p => !categoryId || p.categoryId === categoryId)
      .sort((a, b) => b.attentionScore - a.attentionScore);
  }

  async getChunksForUrl(url: string): Promise<CorpusChunk[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chunks', 'readonly');
      const idx = tx.objectStore('chunks').index('url');
      const req = idx.getAll(url);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  private async deleteChunksForUrl(url: string): Promise<void> {
    const db = await this.openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chunks', 'readwrite');
      const idx = tx.objectStore('chunks').index('url');
      const req = idx.openCursor(IDBKeyRange.only(url));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deletePage(url: string): Promise<void> {
    const db = await this.openDB();
    await this.deleteChunksForUrl(url);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite');
      tx.objectStore('pages').delete(url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['pages', 'chunks', 'categories'], 'readwrite');
      tx.objectStore('pages').clear();
      tx.objectStore('chunks').clear();
      tx.objectStore('categories').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Hybrid (keyword overlap + cosine) search across the whole corpus.
   * Caller supplies the query embedding since CorpusStore doesn't own an
   * embedder (that lives in EmbeddingService, invoked by the message handler).
   */
  async searchWithEmbedding(
    query: string,
    queryEmbedding: number[],
    options: { limit?: number; threshold?: number } = {}
  ): Promise<CorpusSearchResult[]> {
    const { limit = 20, threshold = 0.35 } = options;
    const [pages, chunks] = await Promise.all([this.getAllPages(), this.getAllChunks()]);
    const pageByUrl = new Map(pages.map(p => [p.url, p]));
    const queryTerms = tokenize(query);

    const scored: CorpusSearchResult[] = [];
    for (const chunk of chunks) {
      const page = pageByUrl.get(chunk.metadata.url);
      if (!page) continue;

      const vectorScore = (cosineSimilarity(queryEmbedding, chunk.embedding) + 1) / 2;
      const keywordScore = termOverlapScore(queryTerms, chunk.text);
      const combined = vectorScore * 0.6 + keywordScore * 0.4;

      if (combined >= threshold) {
        scored.push({ page, chunk, score: combined });
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async getAllChunks(): Promise<CorpusChunk[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chunks', 'readonly');
      const req = tx.objectStore('chunks').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllCategories(): Promise<CorpusCategory[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('categories', 'readonly');
      const req = tx.objectStore('categories').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async putCategory(category: CorpusCategory): Promise<void> {
    const db = await this.openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('categories', 'readwrite');
      tx.objectStore('categories').put(category);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async setPageCategory(url: string, categoryId: string): Promise<void> {
    const page = await this.getPage(url);
    if (!page) return;
    page.categoryId = categoryId;
    const db = await this.openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite');
      tx.objectStore('pages').put(page);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Evict lowest-attentionScore pages (oldest lastSeen breaks ties) once the
   * corpus exceeds maxPages.
   */
  private async enforceEviction(): Promise<void> {
    const pages = await this.getAllPages();
    if (pages.length <= this.maxPages) return;

    const sorted = pages.sort((a, b) => {
      if (a.attentionScore !== b.attentionScore) return a.attentionScore - b.attentionScore;
      return a.lastSeen - b.lastSeen;
    });

    const toEvict = sorted.slice(0, pages.length - this.maxPages);
    for (const page of toEvict) {
      await this.deletePage(page.url);
    }
  }

  async getStorageStats(): Promise<{ pageCount: number; chunkCount: number }> {
    const [pages, chunks] = await Promise.all([this.getAllPages(), this.getAllChunks()]);
    return { pageCount: pages.length, chunkCount: chunks.length };
  }

  /**
   * Full corpus snapshot for export. IndexedDB is cleared by Chrome on
   * extension uninstall/reinstall - this is the only way reading history
   * survives that (see src/utils/persistentStorage.ts for the same caveat
   * on settings).
   */
  async exportAll(): Promise<{ version: 1; exportedAt: number; pages: CorpusPage[]; chunks: CorpusChunk[]; categories: CorpusCategory[] }> {
    const [pages, chunks, categories] = await Promise.all([
      this.getAllPages(),
      this.getAllChunks(),
      this.getAllCategories()
    ]);
    return { version: 1, exportedAt: Date.now(), pages, chunks, categories };
  }

  /**
   * Restore from a snapshot produced by exportAll(). Merges into the
   * existing corpus (matching URLs are overwritten) rather than requiring
   * an empty store first.
   */
  async importAll(snapshot: { pages: CorpusPage[]; chunks: CorpusChunk[]; categories: CorpusCategory[] }): Promise<void> {
    const db = await this.openDB();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['pages', 'chunks', 'categories'], 'readwrite');
      const pageStore = tx.objectStore('pages');
      const chunkStore = tx.objectStore('chunks');
      const categoryStore = tx.objectStore('categories');

      for (const page of snapshot.pages) pageStore.put(page);
      for (const chunk of snapshot.chunks) chunkStore.put(chunk);
      for (const category of snapshot.categories) categoryStore.put(category);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await this.enforceEviction();
  }
}

function windowCutoff(window: CorpusTimeWindow): number {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  switch (window) {
    case 'today': return now - DAY;
    case 'week': return now - 7 * DAY;
    case 'month': return now - 30 * DAY;
    case 'all': default: return 0;
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function termOverlapScore(queryTerms: string[], text: string): number {
  if (queryTerms.length === 0) return 0;
  const textLower = text.toLowerCase();
  let hits = 0;
  for (const term of queryTerms) {
    if (textLower.includes(term)) hits++;
  }
  return hits / queryTerms.length;
}
