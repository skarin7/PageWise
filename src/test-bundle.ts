/**
 * Test bundle for console testing
 * This file exports everything needed for testing in browser console
 */

export { PageRAG } from './core/PageRAG';
export { DomChunker } from './core/DomChunker';
export { EmbeddingService } from './core/EmbeddingService';
export { VectorStore } from './core/VectorStore';
export type { Chunk, SearchResult, SearchOptions } from './types';

// Make PageRAG available globally for easy console access
import { PageRAG } from './core/PageRAG';

if (typeof window !== 'undefined') {
  (window as any).PageRAG = PageRAG;
  console.log('PageRAG loaded! Use: const rag = new PageRAG(); await rag.init();');
}

