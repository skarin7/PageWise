/**
 * PageRAG - Main orchestrator for the RAG system
 */

import { DomChunker } from './DomChunker';
import { EmbeddingService } from './EmbeddingService';
import { VectorStore } from './VectorStore';
import type { Chunk, SearchResult, SearchOptions } from '../types';

export class PageRAG {
  private chunker: DomChunker;
  private embedder: EmbeddingService;
  private vectorStore: VectorStore;
  private url: string;
  private initialized = false;
  private chunks: Chunk[] = [];

  constructor(url?: string) {
    this.url = url || window.location.href;
    this.chunker = new DomChunker(this.url);
    // Use singleton EmbeddingService to share model across pages
    this.embedder = EmbeddingService.getInstance();
    this.vectorStore = new VectorStore(this.url);
  }

  /**
   * Initialize the RAG system
   */
  async init(): Promise<void> {
    if (this.initialized) {
      console.log('PageRAG already initialized');
      return;
    }

    try {
      console.log('Initializing PageRAG...');

      // Step 1: Wait for DOM ready
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          document.addEventListener('DOMContentLoaded', resolve);
        });
      }

      // Step 2: Initialize embedding service
      console.log('Step 1/4: Initializing embedding service...');
      await this.embedder.init();

      // Step 3: Initialize vector store
      console.log('Step 2/4: Initializing vector store...');
      await this.vectorStore.init();

      // Step 4: Chunk the page
      console.log('Step 3/4: Chunking page content...');
      this.chunks = await this.chunker.chunk(document);
      console.log(`Found ${this.chunks.length} chunks`);

      if (this.chunks.length === 0) {
        console.warn('No chunks found on this page');
        this.initialized = true;
        return;
      }

      // Step 5: Generate embeddings
      console.log('Step 4/4: Generating embeddings...');
      const texts = this.chunks.map(chunk => chunk.text);
      const embeddings = await this.embedder.embedBatch(texts);

      // Step 6: Insert chunks with embeddings into vector store
      // Note: Orama handles embeddings internally, we just need to insert chunks
      await this.vectorStore.insertChunks(this.chunks);

      this.initialized = true;
      console.log('PageRAG initialized successfully');
    } catch (error) {
      console.error('Failed to initialize PageRAG:', error);
      throw error;
    }
  }

  /**
   * Search for content
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.init();
    }

    if (this.chunks.length === 0) {
      return [];
    }

    try {
      const results = await this.vectorStore.search(query, options);
      
      // Add highlight elements to results
      return results.map(result => {
        const element = this.getElementFromChunk(result.chunk);
        return {
          ...result,
          highlightElement: element || undefined
        };
      });
    } catch (error) {
      console.error('Search error:', error);
      return [];
    }
  }

  /**
   * Highlight a search result
   */
  highlightResult(result: SearchResult): void {
    if (result.highlightElement) {
      result.highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Add highlight class
      result.highlightElement.classList.add('rag-highlight');
      
      // Remove highlight after 3 seconds
      setTimeout(() => {
        result.highlightElement?.classList.remove('rag-highlight');
      }, 3000);
    }
  }

  /**
   * Scroll to a search result
   */
  scrollToResult(result: SearchResult): void {
    if (result.highlightElement) {
      result.highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * Get element from chunk using CSS selector or XPath
   */
  private getElementFromChunk(chunk: Chunk): HTMLElement | null {
    // Try CSS selector first (more reliable)
    if (chunk.metadata.cssSelector) {
      try {
        const element = document.querySelector(chunk.metadata.cssSelector);
        if (element) return element as HTMLElement;
      } catch (e) {
        console.warn('Failed to find element by CSS selector:', e);
      }
    }

    // Fallback to XPath
    if (chunk.metadata.xpath) {
      try {
        const result = document.evaluate(
          chunk.metadata.xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return result.singleNodeValue as HTMLElement;
      } catch (e) {
        console.warn('Failed to find element by XPath:', e);
      }
    }

    return null;
  }

  /**
   * Get all chunks (for debugging)
   */
  getChunks(): Chunk[] {
    return this.chunks;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Re-process the page (useful for dynamic content)
   */
  async reprocess(): Promise<void> {
    this.initialized = false;
    this.chunks = [];
    await this.vectorStore.clear();
    await this.init();
  }

  /**
   * Get storage information (where data is stored)
   * See STORAGE_GUIDE.md for detailed instructions
   */
  async getStorageInfo(): Promise<any> {
    const info = {
      message: 'Storage information',
      location: 'IndexedDB',
      databases: [] as string[],
      instructions: 'Open Chrome DevTools (F12) → Application tab → IndexedDB to inspect storage. See STORAGE_GUIDE.md for details.'
    };

    // Try to list available databases
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      try {
        const databases = await indexedDB.databases();
        info.databases = databases.map(db => db.name || 'unnamed').filter(Boolean) as string[];
      } catch (e) {
        // IndexedDB.databases() might not be available in all browsers
        console.warn('Could not list IndexedDB databases:', e);
      }
    }

    return info;
  }

  /**
   * Inspect IndexedDB database
   * See STORAGE_GUIDE.md for detailed instructions
   */
  async inspectStorage(dbName?: string): Promise<any> {
    const info = await this.getStorageInfo();
    if (dbName) {
      info.message = `Inspecting database: ${dbName}`;
      info.instructions = `To inspect "${dbName}", open Chrome DevTools (F12) → Application tab → IndexedDB → ${dbName}. See STORAGE_GUIDE.md for details.`;
    }
    return info;
  }
}

// Export for global access in console
if (typeof window !== 'undefined') {
  (window as any).PageRAG = PageRAG;
  // Helper function for inspecting storage
  (window as any).inspectStorage = async (dbName?: string) => {
    const rag = new PageRAG();
    return await rag.inspectStorage(dbName);
  };
  // Export LLM config helpers
  (window as any).configureLLMExtraction = async (config: any) => {
    const { saveLLMConfig } = await import('../utils/llmContentExtraction');
    await saveLLMConfig(config);
    console.log('LLM config saved. Reload page to apply.');
  };
  (window as any).getLLMConfig = async () => {
    const { getLLMConfig } = await import('../utils/llmContentExtraction');
    return await getLLMConfig();
  };
}

