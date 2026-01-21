/**
 * Vector Store - Orama with IndexedDB persistence
 */

import { create, insert, search, Orama, Results } from '@orama/orama';
import type { Chunk, SearchResult, SearchOptions } from '../types';
import { EmbeddingService } from './EmbeddingService';

const schema = {
  id: 'string',
  text: 'string',
  headingPath: 'string[]',
  semanticTag: 'string',
  headingLevel: 'number',
  parentChunkId: 'string',
  contentType: 'string',
  context: 'string',
  entity: 'string',
  raw_text: 'string',
  xpath: 'string',
  cssSelector: 'string',
  type: 'string',
  widgetIndex: 'number',
  elementIndex: 'number',
  visible: 'boolean',
  url: 'string'
} as const;

export class VectorStore {
  private db: Orama<typeof schema> | null = null;
  private dbName: string;
  private initialized = false;
  // Store embeddings separately (Orama schema doesn't support number[])
  // Also store chunk data for efficient vector search
  private embeddings: Map<string, number[]> = new Map();
  private chunkCache: Map<string, Chunk> = new Map();
  private embedder: EmbeddingService;

  constructor(url?: string) {
    // Create database name from URL
    const urlObj = new URL(url || window.location.href);
    this.dbName = `orama-${urlObj.hostname}-${this.hashCode(urlObj.pathname)}`;
    // Use singleton EmbeddingService
    this.embedder = EmbeddingService.getInstance();
  }

  /**
   * Initialize Orama database and load embeddings from IndexedDB
   */
  async init(): Promise<void> {
    if (this.initialized && this.db) {
      return;
    }

    try {
      this.db = await create({
        schema,
        id: this.dbName
      });
      
      // Load embeddings from IndexedDB if they exist (but don't validate yet)
      // Validation will happen when chunks are inserted
      await this.loadEmbeddings();
      
      this.initialized = true;
      console.log('Vector store initialized:', this.dbName);
      if (this.embeddings.size > 0) {
        console.log(`Loaded ${this.embeddings.size} embeddings from cache (will validate on chunk insert)`);
      }
    } catch (error) {
      console.error('Failed to initialize vector store:', error);
      throw error;
    }
  }

  /**
   * Save embeddings to IndexedDB
   */
  private async saveEmbeddings(): Promise<void> {
    if (this.embeddings.size === 0) {
      return;
    }

    try {
      const embeddingsData: Record<string, number[]> = {};
      for (const [chunkId, embedding] of this.embeddings.entries()) {
        embeddingsData[chunkId] = embedding;
      }

      // Get chunks from cache (they should match what was just inserted)
      const chunksData: Record<string, Chunk> = {};
      for (const [chunkId, chunk] of this.chunkCache.entries()) {
        chunksData[chunkId] = chunk;
      }

      // Calculate content hash from current chunks
      const contentHash = this.calculateContentHash(chunksData);
      
      // Get embedding provider and model metadata
      const embeddingProvider = this.embedder.getEmbeddingProvider();
      const embeddingModel = this.embedder.getEmbeddingModel();
      const embeddingKey = this.embedder.getEmbeddingKey();
      
      // Use a separate IndexedDB database for embeddings
      const embeddingsDbName = `embeddings_${this.dbName}`;
      
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(embeddingsDbName, 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(['embeddings'], 'readwrite');
          const store = transaction.objectStore('embeddings');
          
          // Store embeddings as JSON with content hash and embedding metadata
          const putRequest = store.put({
            id: 'embeddings',
            data: embeddingsData,
            chunks: chunksData,
            contentHash: contentHash,
            embeddingProvider: embeddingProvider,
            embeddingModel: embeddingModel,
            embeddingKey: embeddingKey,
            timestamp: Date.now()
          });
          
          putRequest.onsuccess = () => {
            console.log(`Saved ${this.embeddings.size} embeddings to IndexedDB`);
            resolve();
          };
          putRequest.onerror = () => reject(putRequest.error);
        };
        
        request.onupgradeneeded = (event: any) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('embeddings')) {
            // Create object store with 'id' as key path
            db.createObjectStore('embeddings', { keyPath: 'id' });
          }
        };
      });
    } catch (error) {
      console.warn('Failed to save embeddings to IndexedDB:', error);
      // Don't throw - embeddings will just be regenerated
    }
  }

  /**
   * Load embeddings from IndexedDB
   */
  private async loadEmbeddings(): Promise<void> {
    try {
      const embeddingsDbName = `embeddings_${this.dbName}`;
      
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(embeddingsDbName, 1);
        
        request.onerror = () => {
          // Database doesn't exist yet, that's OK
          resolve();
        };
        
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(['embeddings'], 'readonly');
          const store = transaction.objectStore('embeddings');
          const getRequest = store.get('embeddings');
          
          getRequest.onsuccess = () => {
            const result = getRequest.result;
            if (result && result.data) {
              // Validate embedding provider/model compatibility
              const storedKey = result.embeddingKey;
              const storedProvider = result.embeddingProvider;
              const storedModel = result.embeddingModel;
              const currentKey = this.embedder.getEmbeddingKey();
              const currentProvider = this.embedder.getEmbeddingProvider();
              const currentModel = this.embedder.getEmbeddingModel();
              
              // Check compatibility: prefer embeddingKey if available, otherwise check provider+model
              // If fields are missing (old format), treat as incompatible
              const isCompatible = storedKey 
                ? storedKey === currentKey
                : (storedProvider && storedModel && storedProvider === currentProvider && storedModel === currentModel);
              
              if (!isCompatible) {
                const oldKey = storedKey || (storedProvider && storedModel ? `${storedProvider}:${storedModel}` : 'legacy (no metadata)');
                if (!storedKey && !storedProvider && !storedModel) {
                  console.log(`[VectorStore] Migrating legacy embeddings (no provider/model metadata) to ${currentKey}. Clearing old embeddings.`);
                } else {
                  console.warn(`[VectorStore] Embedding provider/model changed: ${oldKey} -> ${currentKey}. Clearing embeddings.`);
                }
                this.embeddings.clear();
                this.chunkCache.clear();
                // Will regenerate on next init
                resolve();
                return;
              }
              
              // Restore embeddings
              for (const [chunkId, embedding] of Object.entries(result.data)) {
                this.embeddings.set(chunkId, embedding as number[]);
              }
              
              // Restore chunk cache if available
              if (result.chunks) {
                for (const [chunkId, chunk] of Object.entries(result.chunks)) {
                  this.chunkCache.set(chunkId, chunk as Chunk);
                }
              }
              
              console.log(`Loaded ${this.embeddings.size} embeddings from IndexedDB (${currentKey})`);
            }
            resolve();
          };
          
          getRequest.onerror = () => {
            // No embeddings stored yet, that's OK
            resolve();
          };
        };
        
        request.onupgradeneeded = (event: any) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('embeddings')) {
            // Create object store with 'id' as key path
            db.createObjectStore('embeddings', { keyPath: 'id' });
          }
        };
      });
    } catch (error) {
      console.warn('Failed to load embeddings from IndexedDB:', error);
      // Don't throw - embeddings will just be regenerated
    }
  }

  /**
   * Insert chunks into the vector store with embeddings
   */
  async insertChunks(chunks: Chunk[], embeddings?: number[][]): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    if (!this.db) {
      throw new Error('Vector store not initialized');
    }

    try {
      // Validate embeddings if they were loaded from cache
      let needsRegeneration = false;
      if (this.embeddings.size > 0 && embeddings) {
        const isValid = await this.validateEmbeddings(chunks);
        if (!isValid) {
          console.log('[VectorStore] Content changed - clearing stale embeddings');
          this.embeddings.clear();
          this.chunkCache.clear();
          // Clear Orama database too since content changed
          await this.clear();
          // Re-initialize
          await this.init();
          needsRegeneration = true;
        }
      }
      
      // If content changed, embeddings array is now invalid - caller needs to regenerate
      if (needsRegeneration) {
        throw new Error('Content changed - embeddings need to be regenerated');
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings?.[i];
        
        // Store embedding and chunk data separately
        if (embedding) {
          this.embeddings.set(chunk.id, embedding);
        }
        // Cache chunk data for efficient vector search
        this.chunkCache.set(chunk.id, chunk);
        
        await insert(this.db, {
          id: chunk.id,
          text: chunk.text,
          headingPath: chunk.metadata.headingPath,
          semanticTag: chunk.metadata.semanticTag,
          headingLevel: chunk.metadata.headingLevel,
          parentChunkId: chunk.metadata.parentChunkId || '',
          contentType: chunk.metadata.contentType,
          context: chunk.metadata.context || '',
          entity: chunk.metadata.entity || '',
          raw_text: chunk.metadata.raw_text,
          xpath: chunk.metadata.xpath,
          cssSelector: chunk.metadata.cssSelector || '',
          type: chunk.metadata.type || 'mixed',
          widgetIndex: chunk.metadata.widgetIndex || 0,
          elementIndex: chunk.metadata.elementIndex || 0,
          visible: chunk.metadata.visible,
          url: chunk.metadata.url
        });
      }
      console.log(`Inserted ${chunks.length} chunks into vector store${embeddings ? ` with ${embeddings.length} embeddings` : ''}`);
      
      // Save embeddings to IndexedDB after insertion (with content hash)
      if (embeddings && embeddings.length > 0) {
        await this.saveEmbeddings();
      }
    } catch (error) {
      console.error('Error inserting chunks:', error);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    
    return dotProduct / denominator;
  }

  /**
   * Search for chunks using hybrid search (keyword + vector similarity)
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.db) {
      throw new Error('Vector store not initialized');
    }

    const {
      limit = 10,
      threshold = 0.7,
      hybrid = true
    } = options;

    try {
      // Step 1: Keyword search using Orama (BM25)
      const keywordResults: Results<typeof schema> = await search(this.db, {
        term: query,
        limit: hybrid ? limit * 2 : limit, // Get more results for hybrid
        threshold: 0.1 // Lower threshold to get more candidates
      });

      // Step 2: Vector similarity search (if embeddings available and hybrid mode)
      const vectorScoreMap = new Map<string, number>();
      
      if (hybrid && this.embeddings.size > 0) {
        // Generate query embedding
        await this.embedder.init();
        const queryEmbedding = await this.embedder.embed(query);
        
        // Compute cosine similarity for all chunks with embeddings
        for (const [chunkId, chunkEmbedding] of this.embeddings.entries()) {
          const similarity = this.cosineSimilarity(queryEmbedding, chunkEmbedding);
          // Convert similarity (-1 to 1) to score (0 to 1)
          const score = (similarity + 1) / 2;
          vectorScoreMap.set(chunkId, score);
        }
      }

      // Step 3: Combine keyword and vector results (hybrid)
      if (hybrid && vectorScoreMap.size > 0) {
        // Create a map of chunk IDs to keyword scores
        const keywordScoreMap = new Map<string, number>();
        keywordResults.hits.forEach(hit => {
          keywordScoreMap.set(hit.document.id, hit.score || 0);
        });

        // Combine scores: weighted average (50% keyword, 50% vector)
        const combinedResults: Map<string, { chunk: Chunk; score: number }> = new Map();

        // Process keyword results and combine with vector scores
        keywordResults.hits.forEach(hit => {
          const chunk = this.hitToChunk(hit.document);
          const keywordScore = hit.score || 0;
          const vectorScore = vectorScoreMap.get(chunk.id) || 0;
          // Normalize keyword score (Orama scores can vary, normalize to 0-1)
          const normalizedKeywordScore = Math.min(1, Math.max(0, keywordScore));
          const combinedScore = (normalizedKeywordScore * 0.5) + (vectorScore * 0.5);
          
          combinedResults.set(chunk.id, { chunk, score: combinedScore });
        });

        // Add chunks with high vector scores that weren't in keyword results
        // Get top vector-scored chunks that weren't already included
        const topVectorChunks = Array.from(vectorScoreMap.entries())
          .filter(([chunkId]) => !combinedResults.has(chunkId))
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit);

        // Add these high-scoring vector chunks using cached chunk data
        for (const [chunkId, vectorScore] of topVectorChunks) {
          const cachedChunk = this.chunkCache.get(chunkId);
          if (cachedChunk) {
            const keywordScore = keywordScoreMap.get(chunkId) || 0;
            const normalizedKeywordScore = Math.min(1, Math.max(0, keywordScore));
            const combinedScore = (normalizedKeywordScore * 0.5) + (vectorScore * 0.5);
            combinedResults.set(chunkId, { chunk: cachedChunk, score: combinedScore });
          }
        }

        // Sort by combined score and return top results
        const finalResults = Array.from(combinedResults.values())
          .filter(result => result.score >= threshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        return finalResults;
      } else {
        // Keyword-only search (fallback or when hybrid=false)
        return keywordResults.hits
          .filter(hit => (hit.score || 0) >= threshold)
          .map(hit => ({
            chunk: this.hitToChunk(hit.document),
            score: hit.score || 0
          }))
          .slice(0, limit);
      }
    } catch (error) {
      console.error('Error searching:', error);
      throw error;
    }
  }

  /**
   * Clear all chunks from the store
   */
  async clear(): Promise<void> {
    // Orama doesn't have a direct clear method
    // We need to recreate the database
    if (this.db) {
      this.db = null;
      this.initialized = false;
      this.embeddings.clear(); // Clear embeddings too
      this.chunkCache.clear(); // Clear chunk cache too
      await this.init();
    }
  }

  /**
   * Convert Orama hit to Chunk
   */
  private hitToChunk(doc: any): Chunk {
    return {
      id: doc.id,
      text: doc.text,
      metadata: {
        headingPath: doc.headingPath || [],
        semanticTag: doc.semanticTag || '',
        headingLevel: doc.headingLevel || 0,
        parentChunkId: doc.parentChunkId || undefined,
        contentType: doc.contentType as any,
        context: doc.context,
        entity: doc.entity,
        raw_text: doc.raw_text,
        xpath: doc.xpath,
        cssSelector: doc.cssSelector,
        type: doc.type as any,
        widgetIndex: doc.widgetIndex,
        elementIndex: doc.elementIndex,
        visible: doc.visible,
        url: doc.url
      }
    };
  }

  /**
   * Create a content fingerprint from text by normalizing and removing dynamic content
   * This creates a stable hash that ignores formatting and truly dynamic content (timestamps, relative times)
   * but preserves meaningful dates that are part of the actual content
   */
  private createContentFingerprint(text: string): string {
    if (!text || text.trim().length === 0) {
      return '';
    }

    let normalized = text;

    // Step 1: Normalize whitespace (collapse multiple spaces/newlines to single space)
    normalized = normalized.trim().replace(/\s+/g, ' ');

    // Step 2: Remove/replace only truly dynamic content patterns (not meaningful dates)
    
    // Timestamps with time components (these change on every load): 2024-01-15T10:30:00Z
    // Use a simpler regex to avoid TypeScript parsing issues
    normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[Z0-9:+-]*/g, '[TIMESTAMP]');
    
    // Time-only formats (these are usually dynamic): 10:30 AM, 14:30:45
    normalized = normalized.replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)\b/gi, '[TIME]');
    
    // Relative time expressions (these update constantly): "2 hours ago", "yesterday", "last week"
    normalized = normalized.replace(/\b\d+\s*(second|minute|hour|day|week|month|year)s?\s+ago\b/gi, '[RELATIVE_TIME]');
    normalized = normalized.replace(/\b(yesterday|today|tomorrow|last\s+(week|month|year)|next\s+(week|month|year))\b/gi, '[RELATIVE_TIME]');
    
    // Common dynamic phrases that often precede timestamps (remove the phrase, keep any date)
    normalized = normalized.replace(/\b(last\s+updated?|as\s+of|updated\s+on|modified\s+on):?\s*/gi, '');
    
    // Counters and metrics (these change frequently): "Current count: 123", "1,234 views"
    normalized = normalized.replace(/\b(current\s+count|count|total|number\s+of):?\s*\d+[,.]?\d*\b/gi, (match) => {
      return match.replace(/\d+[,.]?\d*/, '[NUMBER]');
    });
    
    // Remove common tracking/analytics patterns
    normalized = normalized.replace(/\b(visitor|view|pageview|hit)s?:?\s*\d+[,.]?\d*\b/gi, '[METRIC]');
    
    // Step 3: Remove extra spaces created by replacements
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized;
  }

  /**
   * Calculate content hash from chunks
   * This hash changes when content changes, allowing us to detect stale embeddings
   */
  private calculateContentHash(chunks: Record<string, Chunk>): string {
    // Create a deterministic hash from chunk IDs, structural identifiers, and content fingerprints
    const chunkEntries = Object.entries(chunks)
      .sort(([a], [b]) => a.localeCompare(b)) // Sort for consistency
      .map(([id, chunk]) => {
        // Use content fingerprint instead of raw text for stable comparison
        const rawText = chunk.metadata.raw_text || chunk.text;
        const fingerprint = this.createContentFingerprint(rawText);
        
        // Include structural identifiers for additional stability
        const headingPath = chunk.metadata.headingPath?.join('|') || '';
        const contentLength = rawText.length; // Include length as part of fingerprint
        
        // Combine: chunk ID, heading path (structural), content length, and fingerprint
        // Use first 1000 chars of fingerprint for performance (should be enough after normalization)
        const fingerprintSample = fingerprint.substring(0, 1000);
        return `${id}|${headingPath}|${contentLength}|${fingerprintSample}`;
      })
      .join('||'); // Use double pipe to separate chunks
    
    // Include chunk count and structural information
    const chunkCount = Object.keys(chunks).length;
    
    // Create a composite hash that's stable but detects real content changes
    const hashInput = `${chunkCount}||${chunkEntries}`;
    
    return this.hashCode(hashInput);
  }

  /**
   * Check if current chunks match stored content hash
   */
  async validateEmbeddings(chunks: Chunk[]): Promise<boolean> {
    if (this.embeddings.size === 0) {
      return false;
    }

    // Convert chunks to the same format as stored
    const chunksData: Record<string, Chunk> = {};
    for (const chunk of chunks) {
      chunksData[chunk.id] = chunk;
    }

    const currentHash = this.calculateContentHash(chunksData);
    
    // Load stored hash from IndexedDB
    try {
      const embeddingsDbName = `embeddings_${this.dbName}`;
      return new Promise((resolve) => {
        const request = indexedDB.open(embeddingsDbName, 1);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(['embeddings'], 'readonly');
          const store = transaction.objectStore('embeddings');
          const getRequest = store.get('embeddings');
          
          getRequest.onsuccess = () => {
            const result = getRequest.result;
            const storedHash = result?.contentHash;
            
            if (!storedHash) {
              resolve(false);
              return;
            }
            
            // Check content hash first
            const contentHashValid = currentHash === storedHash;
            if (!contentHashValid) {
              console.log('[VectorStore] Content hash mismatch - embeddings are stale');
              console.log('[VectorStore] Stored hash:', storedHash);
              console.log('[VectorStore] Current hash:', currentHash);
              resolve(false);
              return;
            }
            
            // Check embedding provider/model compatibility
            const storedKey = result?.embeddingKey;
            const storedProvider = result?.embeddingProvider;
            const storedModel = result?.embeddingModel;
            const currentKey = this.embedder.getEmbeddingKey();
            const currentProvider = this.embedder.getEmbeddingProvider();
            const currentModel = this.embedder.getEmbeddingModel();
            
            // Check compatibility: prefer embeddingKey if available, otherwise check provider+model
            // If fields are missing (old format), treat as incompatible
            const isCompatible = storedKey 
              ? storedKey === currentKey
              : (storedProvider && storedModel && storedProvider === currentProvider && storedModel === currentModel);
            
            if (!isCompatible) {
              const oldKey = storedKey || (storedProvider && storedModel ? `${storedProvider}:${storedModel}` : 'unknown');
              console.log('[VectorStore] Embedding provider/model mismatch - embeddings are incompatible');
              console.log('[VectorStore] Stored:', oldKey);
              console.log('[VectorStore] Current:', currentKey);
              resolve(false);
              return;
            }
            
            resolve(true);
          };
          
          getRequest.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      });
    } catch (error) {
      console.warn('Failed to validate embeddings:', error);
      return false;
    }
  }

  /**
   * Hash code for URL pathname
   */
  private hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Check if store is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.db !== null;
  }
}

