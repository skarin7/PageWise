import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @xenova/transformers before importing EmbeddingService so that
// the module-level env assignment and fetch interceptor do not run.
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(
    async (_text: string, _opts: unknown) => ({ data: new Float32Array(384).fill(0.1) }),
  ),
  env: { allowLocalModels: true },
}));

// Stub out browser Cache API referenced at module load time
Object.defineProperty(globalThis, 'caches', { value: undefined, writable: true });

import { EmbeddingService } from './EmbeddingService';
import { pipeline } from '@xenova/transformers';

beforeEach(() => {
  EmbeddingService.reset();
  vi.clearAllMocks();
});

// ─── getInstance ───────────────────────────────────────────────────────────

describe('EmbeddingService.getInstance', () => {
  it('returns the same instance on repeated calls (singleton)', () => {
    const a = EmbeddingService.getInstance();
    const b = EmbeddingService.getInstance();
    expect(a).toBe(b);
  });

  it('returns a fresh instance after reset()', () => {
    const a = EmbeddingService.getInstance();
    EmbeddingService.reset();
    const b = EmbeddingService.getInstance();
    expect(a).not.toBe(b);
  });
});

// ─── init ─────────────────────────────────────────────────────────────────

describe('EmbeddingService.init', () => {
  it('sets isInitialized() to true after init', async () => {
    const svc = EmbeddingService.getInstance();
    expect(svc.isInitialized()).toBe(false);
    await svc.init();
    expect(svc.isInitialized()).toBe(true);
  });

  it('calling init() twice does not double-initialise (pipeline called once)', async () => {
    const svc = EmbeddingService.getInstance();
    await svc.init();
    await svc.init();
    expect(pipeline).toHaveBeenCalledTimes(1);
  });
});

// ─── embed ────────────────────────────────────────────────────────────────

describe('EmbeddingService.embed', () => {
  it('returns an array of numbers', async () => {
    const svc = EmbeddingService.getInstance();
    const embedding = await svc.embed('hello world');
    expect(Array.isArray(embedding)).toBe(true);
    embedding.forEach(v => expect(typeof v).toBe('number'));
  });

  it('returns a vector of 384 dimensions (all-MiniLM-L6-v2)', async () => {
    const svc = EmbeddingService.getInstance();
    const embedding = await svc.embed('test sentence');
    expect(embedding).toHaveLength(384);
  });

  it('automatically calls init() when not yet initialised', async () => {
    const svc = EmbeddingService.getInstance();
    expect(svc.isInitialized()).toBe(false);
    await svc.embed('lazy init');
    expect(svc.isInitialized()).toBe(true);
  });
});

// ─── embedBatch ───────────────────────────────────────────────────────────

describe('EmbeddingService.embedBatch', () => {
  it('returns one embedding per input text', async () => {
    const svc = EmbeddingService.getInstance();
    const texts = ['first', 'second', 'third'];
    const result = await svc.embedBatch(texts);
    expect(result).toHaveLength(3);
  });

  it('processes more than one batch (batchSize=10) without error', async () => {
    const svc = EmbeddingService.getInstance();
    const texts = Array.from({ length: 15 }, (_, i) => `text ${i}`);
    const result = await svc.embedBatch(texts);
    expect(result).toHaveLength(15);
    result.forEach(emb => expect(emb).toHaveLength(384));
  });

  it('returns an empty array for empty input', async () => {
    const svc = EmbeddingService.getInstance();
    const result = await svc.embedBatch([]);
    expect(result).toEqual([]);
  });
});
