/**
 * Local Model Service - Transformers.js text generation for content extraction
 * Uses the same WASM/WebGL infrastructure as EmbeddingService
 */

import { pipeline, env } from '@xenova/transformers';

// Configure Transformers.js for browser extension
env.allowLocalModels = false;

// Singleton instance to share across pages
let globalLocalModelService: LocalModelService | null = null;

export class LocalModelService {
  private pipeline: any = null;
  private modelName: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null; // Prevent concurrent initializations

  constructor(modelName: string = 'Xenova/LaMini-Flan-T5-783M') {
    this.modelName = modelName;
  }

  /**
   * Get or create singleton instance
   */
  static getInstance(modelName?: string): LocalModelService {
    if (!globalLocalModelService) {
      globalLocalModelService = new LocalModelService(modelName);
    } else if (modelName && globalLocalModelService.modelName !== modelName) {
      // If different model requested, reset and create new instance
      globalLocalModelService = null;
      globalLocalModelService = new LocalModelService(modelName);
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
   */
  async generate(prompt: string, options?: {
    max_new_tokens?: number;
    temperature?: number;
    top_p?: number;
  }): Promise<string> {
    if (!this.pipeline) {
      await this.init();
    }

    if (!this.pipeline) {
      throw new Error('Text generation pipeline not initialized');
    }

    try {
      const generationOptions = {
        max_new_tokens: options?.max_new_tokens || 50, // Short output for CSS selector
        temperature: options?.temperature || 0.1, // Low temperature for deterministic output
        top_p: options?.top_p || 0.9,
        return_full_text: false
      };

      const result = await this.pipeline(prompt, generationOptions);
      
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

      return generatedText.trim();
    } catch (error) {
      console.error('[LocalModelService] Error generating text:', error);
      throw error;
    }
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.pipeline !== null;
  }

  /**
   * Get current model name
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Reset singleton (for testing or cleanup)
   */
  static reset(): void {
    globalLocalModelService = null;
  }
}

