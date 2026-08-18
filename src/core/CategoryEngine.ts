/**
 * CategoryEngine - clusters corpus pages by embedding similarity.
 * No LLM required: incremental nearest-centroid assignment + TF-IDF-ish
 * labelling from heading/entity metadata already carried on every chunk.
 */

import type { CorpusPage, CorpusChunk, CorpusCategory } from '../types';
import { cosineSimilarity, meanVector, l2Normalize } from '../utils/vectorMath';

const SIMILARITY_THRESHOLD = 0.6;

export class CategoryEngine {
  /**
   * Assigns each page to the nearest existing category (if above threshold)
   * or seeds a new one. Mutates and returns the updated category list.
   * Call after every new page is stored.
   */
  static assignCategory(
    page: CorpusPage,
    pageChunks: CorpusChunk[],
    categories: CorpusCategory[]
  ): { categoryId: string; categories: CorpusCategory[] } {
    const pageEmbedding = page.pageEmbedding;

    let best: { category: CorpusCategory; score: number } | null = null;
    for (const category of categories) {
      const score = cosineSimilarity(pageEmbedding, category.centroid);
      if (!best || score > best.score) {
        best = { category, score };
      }
    }

    if (best && best.score >= SIMILARITY_THRESHOLD) {
      const updated = recenterCategory(best.category, pageEmbedding);
      const newCategories = categories.map(c => (c.id === updated.id ? updated : c));
      return { categoryId: updated.id, categories: newCategories };
    }

    const label = labelFromChunks(pageChunks);
    const newCategory: CorpusCategory = {
      id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label,
      centroid: pageEmbedding,
      pageCount: 1
    };
    return { categoryId: newCategory.id, categories: [...categories, newCategory] };
  }

  static computePageEmbedding(chunkEmbeddings: number[][]): number[] {
    return l2Normalize(meanVector(chunkEmbeddings));
  }
}

function recenterCategory(category: CorpusCategory, newPageEmbedding: number[]): CorpusCategory {
  const n = category.pageCount;
  const blended = category.centroid.map((v, i) => (v * n + newPageEmbedding[i]) / (n + 1));
  return {
    ...category,
    centroid: l2Normalize(blended),
    pageCount: n + 1
  };
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is',
  'are', 'this', 'that', 'it', 'as', 'by', 'at', 'from', 'be', 'was', 'were'
]);

function labelFromChunks(chunks: CorpusChunk[]): string {
  const termCounts = new Map<string, number>();

  for (const chunk of chunks) {
    const terms = [
      ...(chunk.metadata.headingPath || []),
      chunk.metadata.entity || ''
    ].join(' ').toLowerCase().match(/[a-z0-9]+/g) || [];

    for (const term of terms) {
      if (term.length < 3 || STOPWORDS.has(term)) continue;
      termCounts.set(term, (termCounts.get(term) || 0) + 1);
    }
  }

  const top = Array.from(termCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([term]) => term);

  if (top.length === 0) return 'Uncategorized';
  return top.map(capitalize).join(' ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
