/**
 * Embedding Service - Transformers.js integration
 * 
 * Note: Using static import instead of dynamic import to avoid CSP issues
 * with chunk loading in browser extensions.
 */

import { pipeline, env } from '@xenova/transformers';

// Configure Transformers.js for browser extension
// Disable local models, use remote from HuggingFace
env.allowLocalModels = false;

// Intercept fetch requests to use Cache Storage (same as Transformers.js uses)
// This ensures caching works across all pages/tabs in browser extensions
if (typeof window !== 'undefined' && 'caches' in window) {
  const CACHE_NAME = 'transformers-model-cache-v1';
  
  // Track if we're actually downloading (not using cache)
  // This helps suppress misleading progress messages when using cache
  let isDownloadingModel = false;
  
  // Store original fetch
  const originalFetch = window.fetch;
  
  // Intercept fetch for HuggingFace model files and Transformers.js dependencies
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const request = input instanceof Request ? input : new Request(input, init);
    
    // Intercept HuggingFace CDN requests and Transformers.js dependencies (WASM files, etc.)
    const isModelFile = url.includes('huggingface.co') || 
                       url.includes('hf.co') || 
                       url.includes('cdn.jsdelivr.net');
    
    if (isModelFile) {
      try {
        // Open cache
        const cache = await caches.open(CACHE_NAME);
        
        // For cache matching, match by URL only (ignore headers, query params, etc.)
        // This ensures the same file is cached regardless of how it's requested
        // Use ignoreSearch: false to match exact URL, but ignore headers
        const cacheOptions: CacheQueryOptions = {
          ignoreMethod: true,  // Ignore HTTP method
          ignoreVary: true,   // Ignore Vary header
        };
        
        // Try to match by URL string directly (most reliable)
        let cachedResponse = await cache.match(url, cacheOptions);
        
        // If no match, try with Request object (fallback)
        if (!cachedResponse) {
          const cacheKey = new Request(url, { method: 'GET' });
          cachedResponse = await cache.match(cacheKey, cacheOptions);
        }
        
        if (cachedResponse) {
          // Check if cache is still valid (less than 7 days old)
          const cacheDate = cachedResponse.headers.get('date');
          if (cacheDate) {
            const age = Date.now() - new Date(cacheDate).getTime();
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            
            if (age < maxAge) {
              // Using cache - ensure WASM files have correct MIME type
              if (url.includes('.wasm')) {
                const contentType = cachedResponse.headers.get('content-type');
                if (contentType !== 'application/wasm') {
                  // Recreate response with correct MIME type
                  const body = await cachedResponse.arrayBuffer();
                  const headers = new Headers(cachedResponse.headers);
                  headers.set('content-type', 'application/wasm');
                  const fixedResponse = new Response(body, {
                    status: cachedResponse.status,
                    statusText: cachedResponse.statusText,
                    headers: headers
                  });
                  console.log(`[EmbeddingService] ✅ Cache HIT (WASM, fixed MIME): ${url.substring(0, 80)}...`);
                  return fixedResponse;
                }
              }
              console.log(`[EmbeddingService] ✅ Cache HIT (Cache Storage): ${url.substring(0, 80)}...`);
              return cachedResponse;
            } else {
              console.log(`[EmbeddingService] ⏰ Cache expired, re-downloading: ${url.substring(0, 80)}...`);
              // Delete expired cache (try both URL and Request key)
              await cache.delete(url, cacheOptions);
              const cacheKey = new Request(url, { method: 'GET' });
              await cache.delete(cacheKey, cacheOptions);
              isDownloadingModel = true; // We're downloading now
            }
          } else {
            // No date header, assume cache is valid - using cache
            // For WASM files, ensure correct MIME type
            if (url.includes('.wasm')) {
              const contentType = cachedResponse.headers.get('content-type');
              if (contentType !== 'application/wasm') {
                const body = await cachedResponse.arrayBuffer();
                const headers = new Headers(cachedResponse.headers);
                headers.set('content-type', 'application/wasm');
                const fixedResponse = new Response(body, {
                  status: cachedResponse.status,
                  statusText: cachedResponse.statusText,
                  headers: headers
                });
                console.log(`[EmbeddingService] ✅ Cache HIT (WASM, fixed MIME): ${url.substring(0, 80)}...`);
                return fixedResponse;
              }
            }
            const fileType = url.includes('.wasm') ? 'WASM' : url.includes('.json') ? 'JSON' : 'File';
            console.log(`[EmbeddingService] ✅ Cache HIT (${fileType}): ${url.substring(0, 80)}...`);
            return cachedResponse;
          }
        } else {
          // Not in cache - we're downloading
          const fileType = url.includes('.wasm') ? 'WASM' : url.includes('.json') ? 'JSON' : 'File';
          console.log(`[EmbeddingService] ❌ Cache MISS (${fileType}): ${url.substring(0, 80)}...`);
          isDownloadingModel = true;
        }
        
        // Not in cache or expired - fetch and cache
        const response = await originalFetch(request);
        
        // Only cache successful responses
        if (response.ok) {
          // Use URL string as cache key (not Request object) for consistent matching
          // This ensures the same URL always matches, regardless of request headers
          const cacheKeyForPut = new Request(url, { method: 'GET' });
          
          // For WASM files, ensure correct MIME type before caching
          if (url.includes('.wasm')) {
            // Clone the response
            const responseToCache = response.clone();
            const body = await responseToCache.arrayBuffer();
            
            // Ensure correct Content-Type header for WASM files
            const headers = new Headers(responseToCache.headers);
            if (!headers.has('content-type') || headers.get('content-type') !== 'application/wasm') {
              headers.set('content-type', 'application/wasm');
            }
            headers.set('date', new Date().toISOString());
            // Remove Vary header to ensure cache matching works across different requests
            headers.delete('vary');
            
            // Create response with correct headers
            const wasmResponse = new Response(body, {
              status: responseToCache.status,
              statusText: responseToCache.statusText,
              headers: headers
            });
            
            // Cache WASM file with correct MIME type
            await cache.put(cacheKeyForPut, wasmResponse);
            console.log(`[EmbeddingService] 💾 Cached (WASM): ${url.substring(0, 80)}...`);
          } else {
            // For other files (JSON, etc.), we can add date header for expiration
            const responseToCache = response.clone();
            const body = await responseToCache.arrayBuffer();
            
            // Add date header for expiration tracking
            const headers = new Headers(responseToCache.headers);
            headers.set('date', new Date().toISOString());
            // Remove Vary header to ensure cache matching works across different requests
            headers.delete('vary');
            
            // Create new response with date header
            const responseWithDate = new Response(body, {
              status: responseToCache.status,
              statusText: responseToCache.statusText,
              headers: headers
            });
            
            // Store in cache
            await cache.put(cacheKeyForPut, responseWithDate);
            const fileType = url.includes('.json') ? 'JSON' : 'File';
            console.log(`[EmbeddingService] 💾 Cached (${fileType}): ${url.substring(0, 80)}...`);
          }
        }
        
        return response;
      } catch (error) {
        console.warn('[EmbeddingService] Cache error, using original fetch:', error);
        return originalFetch(request);
      }
    }
    
    // Not a model file request - use original fetch
    return originalFetch(request);
  };
  
  // Expose flag to check if we're downloading
  (window as any).__isDownloadingTransformersModel = () => isDownloadingModel;
  
  console.log('[EmbeddingService] ✅ Fetch interceptor configured for Cache Storage');
  console.log('[EmbeddingService] Using Cache Storage (same as Transformers.js)');
  console.log(`[EmbeddingService] Cache name: ${CACHE_NAME}`);
  
  // Verify cache is accessible
  caches.open(CACHE_NAME).then(() => {
    console.log('[EmbeddingService] ✅ Cache Storage accessible');
  }).catch((error) => {
    console.warn('[EmbeddingService] ⚠️ Cache Storage error:', error);
  });
}

// Singleton instance to share across pages
let globalEmbeddingService: EmbeddingService | null = null;

export class EmbeddingService {
  private pipeline: any = null;
  private modelName = 'Xenova/all-MiniLM-L6-v2';
  private initialized = false;
  private initPromise: Promise<void> | null = null; // Prevent concurrent initializations

  /**
   * Get or create singleton instance
   */
  static getInstance(): EmbeddingService {
    if (!globalEmbeddingService) {
      globalEmbeddingService = new EmbeddingService();
    }
    return globalEmbeddingService;
  }

  /**
   * Initialize the embedding model
   * Uses singleton pattern to prevent multiple downloads
   */
  async init(): Promise<void> {
    // If already initialized, return immediately
    if (this.initialized && this.pipeline) {
      console.log('[EmbeddingService] Model already loaded, using cached version');
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      console.log('[EmbeddingService] Model loading in progress, waiting...');
      return this.initPromise;
    }

    // Start initialization
    this.initPromise = this._doInit();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Internal initialization method
   */
  private async _doInit(): Promise<void> {
    const startTime = Date.now();
    let downloadProgress = false;
    let loadedFromCache = false;
    
    // Reset download flag at start of initialization
    if (typeof window !== 'undefined' && (window as any).__isDownloadingTransformersModel) {
      // Reset the flag - we'll set it to true if we see any cache misses
      // This is done in the fetch interceptor
    }
    
    try {
      console.log('[EmbeddingService] Loading model:', this.modelName);
      console.log('[EmbeddingService] Checking cache first...');
      
      // Suppress the "content-length" warning - it's harmless
      // Transformers.js will handle streaming download
      const originalWarn = console.warn;
      const suppressedWarnings: string[] = [];
      console.warn = (...args: any[]) => {
        const message = args.join(' ');
        // Suppress content-length warnings (they're harmless)
        if (message.includes('content-length') || message.includes('Unable to determine')) {
          suppressedWarnings.push(message);
          return; // Don't log these warnings
        }
        originalWarn.apply(console, args);
      };
      
      try {
        this.pipeline = await pipeline('feature-extraction', this.modelName, {
          quantized: true, // Use quantized model for smaller size
          progress_callback: (progress: any) => {
            if (progress) {
              // Check if we're actually downloading (not using cache)
              const isDownloading = typeof window !== 'undefined' && 
                                   (window as any).__isDownloadingTransformersModel && 
                                   (window as any).__isDownloadingTransformersModel();
              
              // Only show download progress if we're actually downloading
              if (progress.status === 'progress' && progress.progress !== undefined && isDownloading) {
                downloadProgress = true;
                
                // Transformers.js progress can be:
                // - A fraction (0-1) - multiply by 100
                // - Already a percentage (0-100) - use as is
                // - Bytes downloaded - ignore (can't convert without total)
                let percent: number;
                if (progress.progress <= 1) {
                  // Fraction (0-1), convert to percentage
                  percent = Math.round(progress.progress * 100);
                } else if (progress.progress <= 100) {
                  // Already a percentage
                  percent = Math.round(progress.progress);
                } else {
                  // Likely bytes or other unit - skip logging to avoid confusion
                  return;
                }
                
                // Clamp to 0-100 to prevent invalid percentages
                percent = Math.max(0, Math.min(100, percent));
                
                // Log every 10% to reduce noise
                if (percent % 10 === 0 && percent > 0) {
                  console.log(`[EmbeddingService] Downloading from HuggingFace: ${percent}%`);
                }
              } else if (progress.status && progress.status !== 'progress' && isDownloading) {
                // Only log status if we're downloading
                console.log(`[EmbeddingService] Status: ${progress.status}`);
              }
              // If using cache, silently ignore progress callbacks
            }
          }
        });
      } finally {
        // Restore console.warn
        console.warn = originalWarn;
        if (suppressedWarnings.length > 0) {
          // Only log if we actually downloaded (not from cache)
          if (downloadProgress) {
            console.log(`[EmbeddingService] Suppressed ${suppressedWarnings.length} harmless content-length warnings`);
          }
        }
      }
      
      const loadTime = Date.now() - startTime;
      loadedFromCache = !downloadProgress && loadTime < 5000; // If no download progress and fast load, likely from cache
      
      this.initialized = true;
      
      if (loadedFromCache) {
        console.log(`[EmbeddingService] ✅ Model loaded from cache in ${loadTime}ms (fast!)`);
      } else if (downloadProgress) {
        console.log(`[EmbeddingService] ✅ Model downloaded and cached in ${Math.round(loadTime / 1000)}s`);
        console.log(`[EmbeddingService] 💡 Next load will be from cache (much faster)`);
      } else {
        console.log(`[EmbeddingService] ✅ Model loaded successfully in ${loadTime}ms`);
      }
    } catch (error) {
      console.error('[EmbeddingService] ❌ Failed to load embedding model:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : String(error);
      console.error('[EmbeddingService] Error message:', errorMessage);
      console.error('[EmbeddingService] Error stack:', errorStack);
      
      // Check network tab for failed requests
      console.error('[EmbeddingService] 💡 TIP: Check Network tab in DevTools to see which request failed');
      console.error('[EmbeddingService] 💡 Look for requests to huggingface.co that returned HTML instead of JSON');
      
      // If it's a CORS/network error, provide helpful message
      if (errorMessage.includes('DOCTYPE') || errorMessage.includes('JSON') || errorMessage.includes('Unexpected token')) {
        const helpfulError = new Error(
          'Failed to load model files from HuggingFace. ' +
          'The server returned HTML instead of JSON. ' +
          'Possible causes:\n' +
          '1. CORS issue - check browser console Network tab\n' +
          '2. Network connectivity issue\n' +
          '3. HuggingFace CDN temporarily unavailable\n\n' +
          'Try:\n' +
          '- Check internet connection\n' +
          '- Open browser DevTools Network tab to see failed requests\n' +
          '- Try again in a few moments\n' +
          '- Make sure you\'re on a regular webpage (not chrome:// pages)'
        );
        console.error('[EmbeddingService] Helpful error message:', helpfulError.message);
        throw helpfulError;
      }
      
      throw error;
    }
  }


  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    if (!this.pipeline) {
      await this.init();
    }

    if (!this.pipeline) {
      throw new Error('Embedding pipeline not initialized');
    }

    try {
      const result = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true
      });

      // Convert tensor to array
      const embedding = Array.from(result.data);
      return embedding as number[];
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batched)
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.pipeline) {
      await this.init();
    }

    if (!this.pipeline) {
      throw new Error('Embedding pipeline not initialized');
    }

    const embeddings: number[][] = [];

    // Process in batches to avoid memory issues
    const batchSize = 10;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await Promise.all(
        batch.map(text => this.embed(text))
      );
      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.pipeline !== null;
  }

  /**
   * Get the embedding provider (e.g., 'transformers', 'ollama')
   * Currently hardcoded to 'transformers' but can be made configurable in the future
   */
  getEmbeddingProvider(): string {
    return 'transformers';
  }

  /**
   * Get the embedding model name
   */
  getEmbeddingModel(): string {
    return this.modelName;
  }

  /**
   * Get combined embedding key (provider:model) for easy comparison
   */
  getEmbeddingKey(): string {
    return `${this.getEmbeddingProvider()}:${this.getEmbeddingModel()}`;
  }

  /**
   * Reset singleton (for testing or cleanup)
   */
  static reset(): void {
    globalEmbeddingService = null;
  }
}

