/**
 * Unit tests for contentFilter – relevance filtering and boilerplate removal
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { filterChunksByRelevance, removeBoilerplate } from '../contentFilter';
import type { Chunk } from '../../types';

type ChunkOverrides = {
  text: string;
  id?: string;
  metadata?: Partial<Chunk['metadata']>;
};

// Minimal Chunk factory for tests
function makeChunk(overrides: ChunkOverrides): Chunk {
  const id = overrides.id ?? `chunk-${Math.random().toString(36).slice(2, 9)}`;
  const text = overrides.text;
  const metadata: Chunk['metadata'] = {
    headingPath: overrides.metadata?.headingPath ?? [],
    semanticTag: overrides.metadata?.semanticTag ?? 'div',
    headingLevel: overrides.metadata?.headingLevel ?? 3,
    contentType: overrides.metadata?.contentType ?? 'paragraph',
    raw_text: overrides.metadata?.raw_text ?? overrides.text,
    xpath: overrides.metadata?.xpath ?? '/html/body',
    visible: overrides.metadata?.visible ?? true,
    url: overrides.metadata?.url ?? 'https://example.com',
    ...overrides.metadata,
  };
  return { id, text, metadata };
}

describe('filterChunksByRelevance', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('returns all chunks when no options and all pass default scores', () => {
    const chunks = [
      makeChunk({ text: 'Meaningful article content here with enough length for quality scoring.' }),
      makeChunk({ text: 'Another good paragraph with substantive content for the reader.' }),
    ];
    const result = filterChunksByRelevance(chunks);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.text)).toEqual(chunks.map((c) => c.text));
  });

  it('filters by minQualityScore when provided', () => {
    const good = makeChunk({
      text: 'A solid paragraph with optimal length between 100 and 500 characters. '.repeat(2),
      metadata: { headingLevel: 2, semanticTag: 'article' },
    });
    const bad = makeChunk({
      text: 'Short.',
      metadata: { headingLevel: 5 },
    });
    const result = filterChunksByRelevance([good, bad], { minQualityScore: 5 });
    expect(result.length).toBeLessThanOrEqual(2);
    const ids = result.map((c) => c.id);
    expect(ids).toContain(good.id);
  });

  it('limits results when maxChunks is set', () => {
    const chunks = [
      makeChunk({ text: 'First chunk with enough words for scoring and relevance.' }),
      makeChunk({ text: 'Second chunk with enough words for scoring and relevance.' }),
      makeChunk({ text: 'Third chunk with enough words for scoring and relevance.' }),
    ];
    const result = filterChunksByRelevance(chunks, { maxChunks: 2 });
    expect(result).toHaveLength(2);
  });

  it('removes duplicates when removeDuplicates is true (default)', () => {
    const text = 'Same content repeated for duplicate detection in the filter.';
    const chunks = [
      makeChunk({ id: 'a', text }),
      makeChunk({ id: 'b', text }),
    ];
    const result = filterChunksByRelevance(chunks);
    expect(result).toHaveLength(1);
  });

  it('keeps duplicates when removeDuplicates is false', () => {
    const text = 'Same content repeated for duplicate detection in the filter.';
    const chunks = [
      makeChunk({ id: 'a', text }),
      makeChunk({ id: 'b', text }),
    ];
    const result = filterChunksByRelevance(chunks, { removeDuplicates: false });
    expect(result).toHaveLength(2);
  });

  it('adds qualityScore, bm25Score, totalScore to chunk metadata', () => {
    const chunk = makeChunk({ text: 'Content with several unique words for scoring.' });
    const result = filterChunksByRelevance([chunk]);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.qualityScore).toBeDefined();
    expect(result[0].metadata.bm25Score).toBeDefined();
    expect(result[0].metadata.totalScore).toBeDefined();
  });
});

describe('removeBoilerplate', () => {
  it('removes chunks that match boilerplate patterns', () => {
    const chunks = [
      makeChunk({ text: 'Real article content here.' }),
      makeChunk({ text: 'Privacy policy and terms of service apply.' }),
      makeChunk({ text: 'All rights reserved. © 2024 Company.' }),
    ];
    const result = removeBoilerplate(chunks);
    expect(result.length).toBeLessThan(chunks.length);
    const texts = result.map((c) => c.text);
    expect(texts).toContain('Real article content here.');
    expect(texts).not.toContain('Privacy policy and terms of service apply.');
  });

  it('filters out very short chunks (under 20 chars)', () => {
    const chunks = [
      makeChunk({ text: 'Short.' }),
      makeChunk({ text: 'A longer chunk that has enough characters to pass.' }),
    ];
    const result = removeBoilerplate(chunks);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('A longer chunk that has enough characters to pass.');
  });

  it('returns empty array when given empty array', () => {
    expect(removeBoilerplate([])).toEqual([]);
  });

  it('preserves chunks with no boilerplate', () => {
    const chunks = [
      makeChunk({ text: 'Technical documentation for the API usage and examples.' }),
    ];
    const result = removeBoilerplate(chunks);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(chunks[0].text);
  });
});
