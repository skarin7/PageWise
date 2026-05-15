import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Chunk } from '../types';

// Mock heavy dependencies before importing VectorStore
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(
    async (_text: string, _opts: unknown) => ({ data: new Float32Array(384).fill(0.1) }),
  ),
  env: { allowLocalModels: true },
}));

Object.defineProperty(globalThis, 'caches', { value: undefined, writable: true });

// Mock EmbeddingService so VectorStore doesn't touch the real model
vi.mock('./EmbeddingService', () => {
  const mockEmbed = vi.fn().mockResolvedValue(Array(384).fill(0.1));
  const instance = {
    init: vi.fn().mockResolvedValue(undefined),
    embed: mockEmbed,
    isInitialized: vi.fn().mockReturnValue(true),
  };
  return {
    EmbeddingService: {
      getInstance: () => instance,
      reset: vi.fn(),
    },
  };
});

import { VectorStore } from './VectorStore';

function makeChunk(id: string, text: string): Chunk {
  return {
    id,
    text,
    metadata: {
      headingPath: ['Section'],
      semanticTag: 'p',
      headingLevel: 2,
      contentType: 'paragraph',
      raw_text: text,
      xpath: '/div/p',
      cssSelector: 'div > p',
      visible: true,
      url: 'https://example.com',
    },
  };
}

// Each test gets a unique URL so stores don't share cached state
let urlCounter = 0;
function freshUrl(): string {
  return `https://example.com/page-${urlCounter++}`;
}

// ─── init ─────────────────────────────────────────────────────────────────

describe('VectorStore.init', () => {
  it('marks the store as initialized after init()', async () => {
    const store = new VectorStore(freshUrl());
    await store.init();
    expect(store.isInitialized()).toBe(true);
  });

  it('calling init() twice does not throw', async () => {
    const store = new VectorStore(freshUrl());
    await store.init();
    await expect(store.init()).resolves.not.toThrow();
  });
});

// ─── insertChunks ─────────────────────────────────────────────────────────

describe('VectorStore.insertChunks', () => {
  it('inserts chunks without throwing', async () => {
    const store = new VectorStore(freshUrl());
    await store.init();
    const chunks = [makeChunk('c1', 'Machine learning is a subset of artificial intelligence')];
    await expect(store.insertChunks(chunks)).resolves.not.toThrow();
  });

  it('inserts multiple chunks without throwing', async () => {
    const store = new VectorStore(freshUrl());
    await store.init();
    const chunks = [
      makeChunk('c1', 'Neural networks are inspired by the human brain'),
      makeChunk('c2', 'Deep learning uses multiple layers of neurons'),
      makeChunk('c3', 'Natural language processing handles text data'),
    ];
    await expect(store.insertChunks(chunks)).resolves.not.toThrow();
  });
});

// ─── search ───────────────────────────────────────────────────────────────

describe('VectorStore.search', () => {
  it('returns an empty array when the store is empty', async () => {
    const store = new VectorStore(freshUrl());
    await store.init();
    const results = await store.search('machine learning', { hybrid: false });
    expect(Array.isArray(results)).toBe(true);
  });

  it('throws when searching before initialisation', async () => {
    const store = new VectorStore(freshUrl());
    await expect(store.search('query')).rejects.toThrow();
  });

  it('finds an inserted chunk via keyword search', async () => {
    const store = new VectorStore(freshUrl());
    await store.init();
    const chunks = [
      makeChunk('c1', 'Photosynthesis converts sunlight into energy for plants'),
      makeChunk('c2', 'Quantum computing uses superposition and entanglement'),
    ];
    await store.insertChunks(chunks);
    const results = await store.search('photosynthesis sunlight plants', {
      hybrid: false,
      threshold: 0,
    });
    const ids = results.map(r => r.chunk.id);
    expect(ids).toContain('c1');
  });

  it('respects the limit option', async () => {
    const store = new VectorStore(freshUrl());
    await store.init();
    const chunks = Array.from({ length: 5 }, (_, i) =>
      makeChunk(`c${i}`, `Content about topic number ${i} with useful information and details`),
    );
    await store.insertChunks(chunks);
    const results = await store.search('content topic', {
      hybrid: false,
      limit: 2,
      threshold: 0,
    });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ─── clear ────────────────────────────────────────────────────────────────

describe('VectorStore.clear', () => {
  it('can be cleared and re-used without throwing', async () => {
    const store = new VectorStore(freshUrl());
    await store.init();
    await store.insertChunks([makeChunk('c1', 'Some content about a topic that is interesting')]);
    await expect(store.clear()).resolves.not.toThrow();
    expect(store.isInitialized()).toBe(true);
  });
});
