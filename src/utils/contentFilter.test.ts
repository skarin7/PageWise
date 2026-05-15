import { describe, it, expect } from 'vitest';
import { filterChunksByRelevance, removeBoilerplate } from './contentFilter';
import type { Chunk } from '../types';

function makeChunk(text: string, meta: Partial<Chunk['metadata']> = {}): Chunk {
  return {
    id: 'test-' + Math.random().toString(36).slice(2),
    text,
    metadata: {
      headingPath: [],
      semanticTag: 'div',
      headingLevel: 0,
      contentType: 'mixed',
      raw_text: text,
      xpath: '/div',
      cssSelector: 'div',
      visible: true,
      url: 'https://example.com',
      ...meta,
    },
  };
}

// ─── removeBoilerplate ─────────────────────────────────────────────────────

describe('removeBoilerplate', () => {
  it('removes chunks shorter than 20 characters', () => {
    const chunks = [makeChunk('Hi'), makeChunk('This is normal content that is long enough')];
    expect(removeBoilerplate(chunks)).toHaveLength(1);
    expect(removeBoilerplate(chunks)[0].text).toContain('normal content');
  });

  it('removes a chunk containing "cookie"', () => {
    const chunks = [makeChunk('We use cookie consent tools on this website')];
    expect(removeBoilerplate(chunks)).toHaveLength(0);
  });

  it('removes a chunk containing "privacy policy"', () => {
    const chunks = [makeChunk('Please read our privacy policy before continuing')];
    expect(removeBoilerplate(chunks)).toHaveLength(0);
  });

  it('removes a chunk containing "terms of service"', () => {
    const chunks = [makeChunk('By using this site you agree to the terms of service')];
    expect(removeBoilerplate(chunks)).toHaveLength(0);
  });

  it('removes a chunk containing "all rights reserved"', () => {
    const chunks = [makeChunk('© 2024 Acme Corp. All rights reserved.')];
    expect(removeBoilerplate(chunks)).toHaveLength(0);
  });

  it('removes a chunk matching the copyright year pattern', () => {
    const chunks = [makeChunk('© 2023 Example Inc.')];
    expect(removeBoilerplate(chunks)).toHaveLength(0);
  });

  it('removes a chunk containing "subscribe to our newsletter"', () => {
    const chunks = [makeChunk('Subscribe to our newsletter and get updates')];
    expect(removeBoilerplate(chunks)).toHaveLength(0);
  });

  it('removes a chunk containing "follow us on"', () => {
    const chunks = [makeChunk('Follow us on Twitter and Facebook for news')];
    expect(removeBoilerplate(chunks)).toHaveLength(0);
  });

  it('removes a chunk containing "social media"', () => {
    const chunks = [makeChunk('Connect with us on all social media platforms')];
    expect(removeBoilerplate(chunks)).toHaveLength(0);
  });

  it('removes a chunk containing "advertisement"', () => {
    const chunks = [makeChunk('This section contains an advertisement for a product')];
    expect(removeBoilerplate(chunks)).toHaveLength(0);
  });

  it('removes a chunk containing "sponsored content"', () => {
    const chunks = [makeChunk('The following is sponsored content from our partner')];
    expect(removeBoilerplate(chunks)).toHaveLength(0);
  });

  it('keeps genuine article content', () => {
    const chunks = [
      makeChunk(
        'The James Webb Space Telescope has captured the most detailed images of distant galaxies ever recorded, revealing structures from the early universe.',
      ),
    ];
    expect(removeBoilerplate(chunks)).toHaveLength(1);
  });

  it('processes mixed arrays, keeping only clean chunks', () => {
    const chunks = [
      makeChunk('Interesting article content about science and discovery'),
      makeChunk('Please accept our cookie policy'),
      makeChunk('Another paragraph about technology trends in 2024'),
    ];
    const result = removeBoilerplate(chunks);
    expect(result).toHaveLength(2);
    result.forEach(c => expect(c.text).not.toMatch(/cookie/i));
  });

  // Documents the actual behavior: even 1 matching pattern removes the chunk.
  // The `matches > 2` guard in the implementation is unreachable dead code —
  // `return !isBoilerplate` already removes all single-pattern matches.
  it('removes any chunk matching even one boilerplate pattern (documents current behavior)', () => {
    const singleMatch = makeChunk(
      'This is a long article with great content, but it mentions cookie consent once',
    );
    expect(removeBoilerplate([singleMatch])).toHaveLength(0);
  });
});

// ─── filterChunksByRelevance ───────────────────────────────────────────────

describe('filterChunksByRelevance', () => {
  it('returns an empty array for empty input', () => {
    expect(filterChunksByRelevance([])).toEqual([]);
  });

  it('respects the maxChunks limit', () => {
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk(`Chunk number ${i} with enough content to pass quality checks for scoring purposes index ${i}`),
    );
    const result = filterChunksByRelevance(chunks, { maxChunks: 3 });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('deduplicates chunks sharing the same first 100 characters', () => {
    const base = 'a'.repeat(50) + ' Some repeated text that will be deduplicated by the filter';
    const chunks = [makeChunk(base), makeChunk(base + ' extra suffix')];
    const result = filterChunksByRelevance(chunks, { removeDuplicates: true });
    expect(result).toHaveLength(1);
  });

  it('keeps duplicates when removeDuplicates is false', () => {
    const text = 'The exact same content appears twice in the chunk list and should not be deduped';
    const chunks = [makeChunk(text), makeChunk(text)];
    const result = filterChunksByRelevance(chunks, { removeDuplicates: false });
    expect(result).toHaveLength(2);
  });

  it('sorts output by totalScore descending', () => {
    const highQuality = makeChunk(
      'Important section with rich content about a meaningful topic that users care about deeply.',
      { headingLevel: 1, semanticTag: 'article' },
    );
    const lowQuality = makeChunk('Click here to read more about our offerings', {
      headingLevel: 6,
      semanticTag: 'div',
    });
    const result = filterChunksByRelevance([lowQuality, highQuality]);
    const scores = result.map(c => c.metadata.totalScore ?? 0);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it('attaches qualityScore, bm25Score, and totalScore to chunk metadata', () => {
    const chunks = [
      makeChunk(
        'A well-structured paragraph with meaningful content that should receive a positive quality score from the filter.',
      ),
    ];
    const result = filterChunksByRelevance(chunks);
    if (result.length > 0) {
      expect(result[0].metadata.qualityScore).toBeDefined();
      expect(result[0].metadata.bm25Score).toBeDefined();
      expect(result[0].metadata.totalScore).toBeDefined();
    }
  });

  it('excludes chunks below minQualityScore', () => {
    const noisy = makeChunk(
      'Cookie privacy policy terms of service all rights reserved subscribe newsletter follow us social media advertisement sponsored click here read more',
      { headingLevel: 6 },
    );
    const result = filterChunksByRelevance([noisy], { minQualityScore: 0 });
    expect(result).toHaveLength(0);
  });

  it('gives heading-level-1 chunks a higher quality score than heading-level-6', () => {
    // Use distinct text so removeDuplicates does not collapse two chunks into one
    const h1Chunk = makeChunk(
      'A substantial introduction about the primary topic covered in this major section of the document.',
      { headingLevel: 1 },
    );
    const h6Chunk = makeChunk(
      'A fine-print footnote about a minor detail buried deep inside the document sub-subsection here.',
      { headingLevel: 6 },
    );
    const result = filterChunksByRelevance([h6Chunk, h1Chunk], {
      minQualityScore: -100,
      minBM25Score: 0,
      removeDuplicates: false,
    });
    const h1Score = result.find(c => c.metadata.headingLevel === 1)?.metadata.qualityScore ?? -Infinity;
    const h6Score = result.find(c => c.metadata.headingLevel === 6)?.metadata.qualityScore ?? -Infinity;
    expect(h1Score).toBeGreaterThan(h6Score);
  });

  it('penalises text shorter than 50 characters in quality scoring', () => {
    const short = makeChunk('Too short.');
    const optimal = makeChunk(
      'A properly sized paragraph with enough content to score well in the quality filter system.',
    );
    const result = filterChunksByRelevance([short, optimal], {
      minQualityScore: -100,
      minBM25Score: 0,
      removeDuplicates: false,
    });
    const shortScore = result.find(c => c.text === 'Too short.')?.metadata.qualityScore ?? 0;
    const optimalScore = result.find(c => c.text === optimal.text)?.metadata.qualityScore ?? 0;
    expect(optimalScore).toBeGreaterThan(shortScore);
  });
});
