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
  console.log('✅ PageRAG loaded! Use: const rag = new PageRAG(); await rag.init();');
  
  // Debug helper functions for test environment
  (window as any).debugRAGInstance = function(ragInstance: any) {
    if (!ragInstance) {
      console.warn('No RAG instance provided');
      return null;
    }
    
    const state = {
      initialized: ragInstance.isInitialized(),
      chunkCount: ragInstance.getChunks().length,
      chunks: ragInstance.getChunks().slice(0, 5).map((c: any) => ({
        id: c.id,
        text: c.text.substring(0, 100) + '...',
        headingPath: c.metadata?.headingPath || []
      }))
    };
    
    console.log('RAG Instance State:', state);
    return state;
  };
  
  (window as any).createTestRAG = async function() {
    console.log('Creating test RAG instance...');
    const rag = new PageRAG();
    await rag.init();
    console.log(`✅ RAG initialized with ${rag.getChunks().length} chunks`);
    return rag;
  };
  
  console.log('✅ Debug functions available:');
  console.log('  - window.createTestRAG() - Create and initialize a RAG instance');
  console.log('  - window.debugRAGInstance(rag) - Inspect RAG instance state');
}

