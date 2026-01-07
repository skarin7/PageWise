/**
 * Web Worker for embedding generation
 * This can be used to offload embedding work from main thread
 */

import { EmbeddingService } from '../core/EmbeddingService';

const embedder = new EmbeddingService();

self.addEventListener('message', async (event) => {
  const { type, data } = event.data;

  if (type === 'INIT') {
    try {
      await embedder.init();
      self.postMessage({ type: 'INIT_SUCCESS' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      self.postMessage({ type: 'INIT_ERROR', error: errorMessage });
    }
  }

  if (type === 'EMBED') {
    try {
      const embedding = await embedder.embed(data.text);
      self.postMessage({ type: 'EMBED_SUCCESS', embedding, id: data.id });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      self.postMessage({ type: 'EMBED_ERROR', error: errorMessage, id: data.id });
    }
  }

  if (type === 'EMBED_BATCH') {
    try {
      const embeddings = await embedder.embedBatch(data.texts);
      self.postMessage({ type: 'EMBED_BATCH_SUCCESS', embeddings });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      self.postMessage({ type: 'EMBED_BATCH_ERROR', error: errorMessage });
    }
  }
});

