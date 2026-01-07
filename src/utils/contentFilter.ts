/**
 * Content filtering utilities (Crawl4AI-style)
 * BM25-based relevance filtering and content quality scoring
 */

import type { Chunk } from '../types';

/**
 * Calculate BM25 score for a chunk
 * BM25 is a ranking function used to estimate relevance
 */
function calculateBM25Score(
  chunk: Chunk,
  avgChunkLength: number,
  totalChunks: number
): number {
  const k1 = 1.5; // Term frequency saturation parameter
  const b = 0.75; // Length normalization parameter
  
  const text = chunk.text.toLowerCase();
  const words = text.split(/\s+/).filter(w => w.length > 2);
  const uniqueWords = new Set(words);
  const chunkLength = words.length;
  
  // Calculate term frequency (TF) and inverse document frequency (IDF)
  let score = 0;
  
  uniqueWords.forEach(word => {
    // Term frequency in this chunk
    const tf = words.filter(w => w === word).length;
    
    // Inverse document frequency (simplified - assumes all words are equally important)
    // In a full implementation, we'd count word frequency across all chunks
    const idf = Math.log((totalChunks + 1) / (1 + 1)); // Simplified
    
    // BM25 formula
    const numerator = idf * tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (chunkLength / avgChunkLength));
    score += numerator / denominator;
  });
  
  return score;
}

/**
 * Calculate content quality score for a chunk
 */
function calculateQualityScore(chunk: Chunk): number {
  let score = 0;
  const text = chunk.text;
  const textLength = text.length;
  
  // Positive indicators
  if (chunk.metadata?.headingLevel && chunk.metadata.headingLevel <= 3) {
    score += 10; // Higher-level headings are more important
  }
  
  if (chunk.metadata?.semanticTag === 'article' || chunk.metadata?.semanticTag === 'main') {
    score += 5; // Semantic tags indicate importance
  }
  
  // Text length scoring (optimal range: 100-500 chars)
  if (textLength >= 100 && textLength <= 500) {
    score += 10; // Optimal length
  } else if (textLength >= 50 && textLength < 100) {
    score += 5; // Short but acceptable
  } else if (textLength > 500 && textLength <= 1000) {
    score += 5; // Long but acceptable
  } else if (textLength < 50) {
    score -= 10; // Too short
  } else if (textLength > 1000) {
    score -= 5; // Too long (might need splitting)
  }
  
  // Negative indicators
  const linkDensity = (text.match(/\[.*?\]\(.*?\)/g) || []).length / (textLength / 100);
  if (linkDensity > 5) {
    score -= 15; // Too many links (likely navigation)
  }
  
  // Common noise phrases
  const noisePhrases = [
    'cookie', 'privacy policy', 'terms of service', 'all rights reserved',
    'subscribe', 'newsletter', 'follow us', 'social media',
    'advertisement', 'sponsored', 'click here', 'read more'
  ];
  
  const lowerText = text.toLowerCase();
  noisePhrases.forEach(phrase => {
    if (lowerText.includes(phrase)) {
      score -= 5;
    }
  });
  
  // Repetitive content (same word repeated many times)
  const words = text.split(/\s+/);
  const wordFreq = new Map<string, number>();
  words.forEach(word => {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  });
  
  let maxFreq = 0;
  wordFreq.forEach(freq => {
    if (freq > maxFreq) maxFreq = freq;
  });
  
  if (maxFreq > words.length * 0.3) {
    score -= 10; // Too repetitive
  }
  
  return score;
}

/**
 * Filter chunks by relevance and quality
 */
export function filterChunksByRelevance(
  chunks: Chunk[],
  options: {
    minQualityScore?: number;
    minBM25Score?: number;
    maxChunks?: number;
    removeDuplicates?: boolean;
  } = {}
): Chunk[] {
  const {
    minQualityScore = 0,
    minBM25Score = 0,
    maxChunks,
    removeDuplicates = true
  } = options;
  
  // Calculate average chunk length for BM25
  const avgLength = chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length || 1;
  
  // Score all chunks
  const scoredChunks = chunks.map(chunk => {
    const qualityScore = calculateQualityScore(chunk);
    const bm25Score = calculateBM25Score(chunk, avgLength, chunks.length);
    const totalScore = qualityScore + bm25Score;
    
    return {
      chunk,
      qualityScore,
      bm25Score,
      totalScore
    };
  });
  
  // Filter by minimum scores
  let filtered = scoredChunks.filter(
    s => s.qualityScore >= minQualityScore && s.bm25Score >= minBM25Score
  );
  
  // Remove duplicates if requested
  if (removeDuplicates) {
    const seen = new Set<string>();
    filtered = filtered.filter(s => {
      const key = s.chunk.text.toLowerCase().trim().substring(0, 100);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  
  // Sort by total score (highest first)
  filtered.sort((a, b) => b.totalScore - a.totalScore);
  
  // Limit to maxChunks if specified
  if (maxChunks && filtered.length > maxChunks) {
    filtered = filtered.slice(0, maxChunks);
  }
  
  // Add scores to chunk metadata for debugging
  filtered.forEach(scored => {
    scored.chunk.metadata = {
      ...scored.chunk.metadata,
      qualityScore: scored.qualityScore,
      bm25Score: scored.bm25Score,
      totalScore: scored.totalScore
    };
  });
  
  console.log(`[ContentFilter] Filtered ${chunks.length} chunks to ${filtered.length} high-quality chunks`);
  
  return filtered.map(s => s.chunk);
}

/**
 * Remove boilerplate and low-value content
 */
export function removeBoilerplate(chunks: Chunk[]): Chunk[] {
  const boilerplatePatterns = [
    /cookie/i,
    /privacy policy/i,
    /terms of service/i,
    /all rights reserved/i,
    /© \d{4}/i,
    /subscribe to our newsletter/i,
    /follow us on/i,
    /social media/i,
    /advertisement/i,
    /sponsored content/i
  ];
  
  return chunks.filter(chunk => {
    const text = chunk.text.toLowerCase();
    const isBoilerplate = boilerplatePatterns.some(pattern => pattern.test(text));
    
    // Also filter very short chunks (but be less aggressive - allow 20+ chars)
    if (chunk.text.trim().length < 20) {
      return false;
    }
    
    // Check if chunk is mostly boilerplate (more than 50% matches patterns)
    const matches = boilerplatePatterns.filter(pattern => pattern.test(text)).length;
    if (matches > 2) { // If 3+ patterns match, likely boilerplate
      return false;
    }
    
    return !isBoilerplate;
  });
}

