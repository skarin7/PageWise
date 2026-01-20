/**
 * Local Model Service - Transformers.js text generation for content extraction
 * Uses the same WASM/WebGL infrastructure as EmbeddingService
 */

import { pipeline, env } from '@xenova/transformers';

// Configure Transformers.js for browser extension
env.allowLocalModels = false;

export type LocalModelProvider = 'transformers' | 'ollama';

export interface LocalModelOptions {
  provider?: LocalModelProvider;
  modelName?: string;
  ollamaUrl?: string;
  requestTimeoutMs?: number;
}

// Singleton instance to share across pages
let globalLocalModelService: LocalModelService | null = null;

export class LocalModelService {
  private pipeline: any = null;
  private modelName: string;
  private provider: LocalModelProvider;
  private ollamaUrl: string;
  private requestTimeoutMs: number;
  private initialized = false;
  private initPromise: Promise<void> | null = null; // Prevent concurrent initializations

  constructor(options: string | LocalModelOptions = 'Xenova/LaMini-Flan-T5-783M') {
    if (typeof options === 'string') {
      this.modelName = options;
      this.provider = 'transformers';
      this.ollamaUrl = 'http://localhost:11434/api/generate';
      this.requestTimeoutMs = 20000;
    } else {
      this.provider = options.provider || 'transformers';
      const defaultModelName = this.provider === 'ollama' ? 'llama3' : 'Xenova/LaMini-Flan-T5-783M';
      this.modelName = options.modelName || defaultModelName;
      this.ollamaUrl = options.ollamaUrl || 'http://localhost:11434/api/generate';
      this.requestTimeoutMs = options.requestTimeoutMs ?? 20000;
    }
  }

  /**
   * Get or create singleton instance
   */
  static getInstance(options?: string | LocalModelOptions): LocalModelService {
    if (!globalLocalModelService) {
      globalLocalModelService = new LocalModelService(options);
    } else if (options) {
      const nextOptions = typeof options === 'string' ? { modelName: options } : options;
      const nextProvider = nextOptions.provider || 'transformers';
      const nextDefaultModel = nextProvider === 'ollama' ? 'llama3' : 'Xenova/LaMini-Flan-T5-783M';
      const nextModelName = nextOptions.modelName || nextDefaultModel;
      const nextOllamaUrl = nextOptions.ollamaUrl || 'http://localhost:11434/api/generate';

      if (
        globalLocalModelService.provider !== nextProvider ||
        globalLocalModelService.modelName !== nextModelName ||
        globalLocalModelService.ollamaUrl !== nextOllamaUrl
      ) {
        // If different model/provider requested, reset and create new instance
        globalLocalModelService = null;
        globalLocalModelService = new LocalModelService(options);
      }
    }
    return globalLocalModelService;
  }

  /**
   * Initialize the text generation model
   * Uses singleton pattern to prevent multiple downloads
   */
  async init(): Promise<void> {
    // If already initialized, return immediately
    if (this.initialized && this.pipeline) {
      console.log('[LocalModelService] Model already loaded, using cached version');
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      console.log('[LocalModelService] Model loading in progress, waiting...');
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
    
    try {
      if (this.provider === 'ollama') {
        console.log('[LocalModelService] Using Ollama provider');
        this.initialized = true;
        return;
      }

      console.log('[LocalModelService] Loading model:', this.modelName);
      console.log('[LocalModelService] Transformers.js will automatically use cache if available...');
      
      // Determine pipeline type based on model name
      // T5 models use text2text-generation, others use text-generation
      const pipelineType = this.modelName.includes('T5') || this.modelName.includes('Flan') 
        ? 'text2text-generation' 
        : 'text-generation';
      
      console.log(`[LocalModelService] Using pipeline type: ${pipelineType}`);
      
      // Suppress the "content-length" warning - it's harmless
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
        this.pipeline = await pipeline(pipelineType, this.modelName, {
          quantized: true, // Use quantized model for smaller size
          progress_callback: (progress: any) => {
            if (progress && progress.status === 'progress' && progress.progress !== undefined) {
              // Transformers.js progress can be:
              // - A fraction (0-1) - multiply by 100
              // - Already a percentage (0-100) - use as is
              let percent: number;
              if (progress.progress <= 1) {
                percent = Math.round(progress.progress * 100);
              } else if (progress.progress <= 100) {
                percent = Math.round(progress.progress);
              } else {
                return; // Skip logging bytes
              }
              
              percent = Math.max(0, Math.min(100, percent));
              
              // Log every 10% to reduce noise
              if (percent % 10 === 0 && percent > 0) {
                console.log(`[LocalModelService] Downloading model: ${percent}%`);
              }
            } else if (progress.status && progress.status !== 'progress') {
              console.log(`[LocalModelService] Status: ${progress.status}`);
            }
          }
        });
      } finally {
        // Restore console.warn
        console.warn = originalWarn;
        if (suppressedWarnings.length > 0) {
          console.log(`[LocalModelService] Suppressed ${suppressedWarnings.length} harmless content-length warnings`);
        }
      }
      
      const loadTime = Date.now() - startTime;
      this.initialized = true;
      
      console.log(`[LocalModelService] ✅ Model loaded successfully in ${Math.round(loadTime / 1000)}s`);
      console.log(`[LocalModelService] 💡 Next load will be from cache (much faster)`);
    } catch (error) {
      console.error('[LocalModelService] ❌ Failed to load model:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : String(error);
      console.error('[LocalModelService] Error message:', errorMessage);
      console.error('[LocalModelService] Error stack:', errorStack);
      throw error;
    }
  }

  /**
   * Generate text using the model
   * Supports streaming for Ollama provider
   */
  async generate(
    prompt: string, 
    options?: {
      max_new_tokens?: number;
      temperature?: number;
      top_p?: number;
      onChunk?: (chunk: string) => void; // Streaming callback
    }
  ): Promise<string> {
    if (this.provider === 'ollama') {
      // Use streaming for Ollama if callback is provided
      if (options?.onChunk) {
        return this.generateWithOllamaStream(prompt, options);
      }
      return this.generateWithOllama(prompt, options);
    }

    if (!this.pipeline) {
      await this.init();
    }

    if (!this.pipeline) {
      throw new Error('Text generation pipeline not initialized');
    }

    try {
      // Use provided options or defaults
      const generationOptions = {
        max_new_tokens: options?.max_new_tokens ?? 600, // Default to 600 for detailed answers
        temperature: options?.temperature ?? 0.4, // Higher temperature for more natural responses
        top_p: options?.top_p ?? 0.9,
        return_full_text: false
      };

      console.log('[LocalModelService] Generating with options:', generationOptions);
      console.log('[LocalModelService] Prompt length:', prompt.length);
      console.log('[LocalModelService] Prompt (first 300 chars):', prompt.substring(0, 300));

      const result = await this.pipeline(prompt, generationOptions);
      
      console.log('[LocalModelService] Raw result:', result);
      
      // Extract text from result
      // Result format depends on pipeline type
      let generatedText: string;
      if (Array.isArray(result) && result.length > 0) {
        generatedText = result[0].generated_text || result[0].text || '';
      } else if (typeof result === 'string') {
        generatedText = result;
      } else if (result && typeof result === 'object' && 'generated_text' in result) {
        generatedText = result.generated_text;
      } else {
        generatedText = String(result);
      }

      console.log('[LocalModelService] Extracted text:', generatedText);
      return generatedText.trim();
    } catch (error) {
      console.error('[LocalModelService] Error generating text:', error);
      throw error;
    }
  }

  private async generateWithOllama(prompt: string, options?: {
    max_new_tokens?: number;
    temperature?: number;
    top_p?: number;
  }): Promise<string> {
    await this.init();

    // Use background script proxy to avoid CORS issues
    // Check if we're in a browser extension context
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      return this.generateWithOllamaViaProxy(prompt, options);
    }

    // Fallback to direct fetch (for testing outside extension context)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(this.ollamaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.modelName,
          prompt,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.4,
            top_p: options?.top_p ?? 0.9,
            num_predict: options?.max_new_tokens ?? 600
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Ollama API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const output = (data.response || '').trim();
      console.log('[LocalModelService] Ollama response length:', output.length);
      return output;
    } catch (error) {
      console.error('[LocalModelService] Ollama generation failed:', error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async generateWithOllamaViaProxy(prompt: string, options?: {
    max_new_tokens?: number;
    temperature?: number;
    top_p?: number;
    onChunk?: (chunk: string) => void;
  }): Promise<string> {
    // If streaming callback is provided, use streaming
    if (options?.onChunk) {
      return this.generateWithOllamaStream(prompt, options);
    }
    
    // Otherwise use non-streaming
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        reject(new Error('Chrome extension API not available'));
        return;
      }

      // Build options object - only include valid Ollama options
      const ollamaOptions: Record<string, any> = {};
      if (options?.temperature !== undefined) {
        ollamaOptions.temperature = options.temperature;
      }
      if (options?.max_new_tokens !== undefined) {
        ollamaOptions.num_predict = options.max_new_tokens;
      }
      // top_p might not be supported by all models, make it optional
      if (options?.top_p !== undefined) {
        ollamaOptions.top_p = options.top_p;
      }
      
      // Build request body matching Ollama API format exactly
      const requestBody: Record<string, any> = {
        model: this.modelName,
        prompt: prompt,
        stream: false
      };
      
      // Only include options if we have any
      if (Object.keys(ollamaOptions).length > 0) {
        requestBody.options = ollamaOptions;
      }
      
      console.log('[LocalModelService] Sending Ollama request:', {
        url: this.ollamaUrl,
        model: this.modelName,
        body: requestBody
      });
      
      chrome.runtime.sendMessage(
        {
          type: 'OLLAMA_REQUEST',
          url: this.ollamaUrl,
          body: requestBody,
          timeout: this.requestTimeoutMs
        },
        (response) => {
          // Check for Chrome extension API errors
          if (chrome.runtime.lastError) {
            console.error('[LocalModelService] Chrome runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response) {
            reject(new Error('No response from background script'));
            return;
          }

          if (!response.success) {
            const errorMsg = response.error || 'Ollama request failed';
            console.error('[LocalModelService] Ollama request failed:', {
              error: errorMsg,
              model: this.modelName,
              url: this.ollamaUrl
            });
            
            // Provide helpful error message for 403
            if (errorMsg.includes('403')) {
              reject(new Error(
                `Ollama 403 Error: Model "${this.modelName}" may not exist or is not available. ` +
                `Please verify:\n` +
                `1. The model name is correct (use: ollama list to see available models)\n` +
                `2. The model is pulled: ollama pull ${this.modelName}\n` +
                `3. Ollama is running: ollama serve\n` +
                `Original error: ${errorMsg}`
              ));
            } else {
              reject(new Error(errorMsg));
            }
            return;
          }

          const output = (response.data?.response || '').trim();
          if (!output) {
            console.warn('[LocalModelService] Ollama returned empty response');
            reject(new Error('Ollama returned empty response. Check if the model is working correctly.'));
            return;
          }
          
          console.log('[LocalModelService] Ollama response length (via proxy):', output.length);
          resolve(output);
        }
      );
    });
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    if (this.provider === 'ollama') {
      return this.initialized;
    }
    return this.initialized && this.pipeline !== null;
  }

  /**
   * Get current model name
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Generate text with Ollama using streaming
   */
  private async generateWithOllamaStream(
    prompt: string, 
    options?: {
      max_new_tokens?: number;
      temperature?: number;
      top_p?: number;
      onChunk?: (chunk: string) => void;
    }
  ): Promise<string> {
    await this.init();

    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        reject(new Error('Chrome extension API not available'));
        return;
      }

      // Build options object - only include valid Ollama options
      const ollamaOptions: Record<string, any> = {};
      if (options?.temperature !== undefined) {
        ollamaOptions.temperature = options.temperature;
      }
      if (options?.max_new_tokens !== undefined) {
        ollamaOptions.num_predict = options.max_new_tokens;
      }
      if (options?.top_p !== undefined) {
        ollamaOptions.top_p = options.top_p;
      }
      
      // Build request body with streaming enabled
      const requestBody: Record<string, any> = {
        model: this.modelName,
        prompt: prompt,
        stream: true // Enable streaming
      };
      
      if (Object.keys(ollamaOptions).length > 0) {
        requestBody.options = ollamaOptions;
      }
      
      let fullResponse = '';
      
      // Use long-lived connection for streaming
      const messagePort = chrome.runtime.connect({ name: 'ollama-stream' });
      
      // Send initial request
      messagePort.postMessage({
        type: 'OLLAMA_STREAM_START',
        url: this.ollamaUrl,
        body: requestBody,
        timeout: this.requestTimeoutMs
      });
      
      messagePort.onMessage.addListener((response) => {
        if (response.error) {
          messagePort.disconnect();
          reject(new Error(response.error));
          return;
        }
        
        if (response.chunk) {
          fullResponse += response.chunk;
          // Call the streaming callback
          if (options?.onChunk) {
            options.onChunk(response.chunk);
          }
        }
        
        if (response.done) {
          messagePort.disconnect();
          resolve(fullResponse.trim());
        }
      });
      
      messagePort.onDisconnect.addListener(() => {
        if (fullResponse) {
          resolve(fullResponse.trim());
        } else if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          reject(new Error('Stream disconnected'));
        }
      });
    });
  }

  /**
   * Reset singleton (for testing or cleanup)
   */
  static reset(): void {
    globalLocalModelService = null;
  }
}

