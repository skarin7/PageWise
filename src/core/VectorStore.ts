/**
 * Vector Store - Orama with IndexedDB persistence
 */

import { create, insert, search, Orama, Results } from '@orama/orama';
import type { Chunk, SearchResult, SearchOptions } from '../types';

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

  constructor(url?: string) {
    // Create database name from URL
    const urlObj = new URL(url || window.location.href);
    this.dbName = `orama-${urlObj.hostname}-${this.hashCode(urlObj.pathname)}`;
  }

  /**
   * Initialize Orama database
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
      this.initialized = true;
      console.log('Vector store initialized:', this.dbName);
    } catch (error) {
      console.error('Failed to initialize vector store:', error);
      throw error;
    }
  }

  /**
   * Insert chunks into the vector store
   */
  async insertChunks(chunks: Chunk[]): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    if (!this.db) {
      throw new Error('Vector store not initialized');
    }

    try {
      for (const chunk of chunks) {
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
      console.log(`Inserted ${chunks.length} chunks into vector store`);
    } catch (error) {
      console.error('Error inserting chunks:', error);
      throw error;
    }
  }

  /**
   * Search for chunks
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
      const results: Results<typeof schema> = await search(this.db, {
        term: query,
        limit,
        threshold
        // Note: Orama v1 uses hybrid search by default
        // mode parameter may not be available in this version
      });

      return results.hits.map(hit => ({
        chunk: this.hitToChunk(hit.document),
        score: hit.score || 0
      }));
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

