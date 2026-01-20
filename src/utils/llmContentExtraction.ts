/**
 * LLM-based content extraction (Crawl4AI-style)
 * Uses LLM to intelligently identify main content area
 * Supports local models (Ollama) and remote APIs
 */

export interface LLMConfig {
  enabled: boolean;
  provider?: 'transformers' | 'ollama' | 'openai' | 'custom'; // transformers = local model
  model?: string; // For transformers: "Xenova/LaMini-Flan-T5-783M", for APIs: "llama3.2", "mistral", etc.
  apiUrl?: string; // e.g., "http://localhost:11434/api/generate" for Ollama, "https://api.openai.com/v1" for OpenAI, or custom endpoint
  apiKey?: string; // For remote APIs like OpenAI and custom OpenAI-compatible APIs
  timeout?: number; // Request timeout in ms
}

const DEFAULT_CONFIG: LLMConfig = {
  enabled: false,
  provider: 'transformers', // Use local model by default
  model: 'Xenova/LaMini-Flan-T5-783M', // Small, fast instruction model
  timeout: 15000 // Longer timeout for first model load
};

/**
 * Extract HTML structure summary for LLM
 */
function extractHTMLStructure(document: Document): string {
  const body = document.body;
  if (!body) return '';

  const structure: string[] = [];
  const maxDepth = 3;
  
  function traverse(element: HTMLElement, depth: number = 0, path: string = ''): void {
    if (depth > maxDepth) return;
    
    // Skip iframes and their content
    if (element.tagName.toLowerCase() === 'iframe') {
      return;
    }
    if (element.closest('iframe')) {
      return;
    }
    
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const classes = element.className ? `.${element.className.split(' ').slice(0, 2).join('.')}` : '';
    const role = element.getAttribute('role') ? `[role="${element.getAttribute('role')}"]` : '';
    
    const selector = `${tag}${id}${classes}${role}`;
    const textPreview = (element.textContent || '').substring(0, 100).replace(/\s+/g, ' ');
    const childCount = element.children.length;
    
    structure.push(`${'  '.repeat(depth)}${selector} (${childCount} children, ~${textPreview.length} chars)`);
    
    // Only traverse direct children to keep structure manageable (exclude iframes)
    if (depth < maxDepth) {
      Array.from(element.children)
        .filter(child => {
          const childEl = child as HTMLElement;
          return childEl.tagName.toLowerCase() !== 'iframe' && !childEl.closest('iframe');
        })
        .slice(0, 10)
        .forEach(child => {
          traverse(child as HTMLElement, depth + 1);
        });
    }
  }
  
  // Filter out iframes from body children
  Array.from(body.children)
    .filter(child => {
      const childEl = child as HTMLElement;
      return childEl.tagName.toLowerCase() !== 'iframe';
    })
    .slice(0, 20)
    .forEach(child => {
      traverse(child as HTMLElement, 0);
    });
  
  return structure.join('\n');
}

/**
 * Create prompt for LLM to identify main content
 */
function createContentExtractionPrompt(htmlStructure: string, url: string): string {
  return `You are analyzing a web page to identify the main content area. Your task is to determine which HTML element contains the primary article/content (not navigation, footer, header, or ads).

HTML Structure (body children):
${htmlStructure}

URL: ${url}

Instructions:
1. Analyze the HTML structure above
2. Identify the element that contains the main article/content
3. Return ONLY a CSS selector that uniquely identifies this element
4. The selector should be specific enough to target the main content container
5. Prefer semantic selectors (main, article, [role="main"]) if available
6. If no clear main content, return the selector for the element with the most substantial text content

Return format: Just the CSS selector, nothing else. Example: "main" or "#content" or ".article-content" or "body > div:nth-child(2)"

IMPORTANT: Do NOT select iframes or elements inside iframes. Ignore chatbot widgets, ads, and third-party embeds.

CSS Selector:`;
}

/**
 * Call Transformers.js local model
 */
async function callTransformersAPI(config: LLMConfig, prompt: string): Promise<string> {
  const { LocalModelService } = await import('../core/LocalModelService');
  const modelName = config.model || 'Xenova/LaMini-Flan-T5-783M';
  
  try {
    console.log('[LLMContentExtraction] Using local Transformers.js model:', modelName);
    const service = LocalModelService.getInstance(modelName);
    await service.init();
    
    // Format prompt for instruction-following model
    // T5/Flan models work better with instruction format
    let formattedPrompt = prompt;
    if (modelName.includes('T5') || modelName.includes('Flan')) {
      // T5 models work well with direct prompts
      formattedPrompt = prompt;
    } else {
      // For other models, add instruction prefix
      formattedPrompt = `Given the following HTML structure, identify the CSS selector for the main content area. Return ONLY the CSS selector.\n\n${prompt}\n\nCSS Selector:`;
    }
    
    const response = await service.generate(formattedPrompt, {
      max_new_tokens: 50, // CSS selectors are short
      temperature: 0.1, // Low temperature for deterministic output
      top_p: 0.9
    });
    
    console.log('[LLMContentExtraction] Local model response:', response);
    return response;
  } catch (error) {
    console.error('[LLMContentExtraction] Local model generation failed:', error);
    throw error;
  }
}

/**
 * Call Ollama API via background script proxy to avoid CORS issues
 */
async function callOllamaAPI(config: LLMConfig, prompt: string): Promise<string> {
  const apiUrl = config.apiUrl || DEFAULT_CONFIG.apiUrl!;
  const model = config.model || DEFAULT_CONFIG.model!;
  const timeout = config.timeout || 30000;
  
  // Use background script proxy if available (browser extension context)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    return new Promise((resolve, reject) => {
      // Try minimal request first (no options) to avoid 403 errors
      // Some Ollama versions/models may reject requests with options
      const requestBody = {
        model: model,
        prompt: prompt,
        stream: false
        // Start without options - add them only if needed
      };
      
      chrome.runtime.sendMessage(
        {
          type: 'OLLAMA_REQUEST',
          url: apiUrl,
          body: requestBody,
          timeout: timeout
        },
        (response) => {
          // Check for Chrome extension API errors
          if (chrome.runtime.lastError) {
            console.error('[LLMContentExtraction] Chrome runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response) {
            reject(new Error('No response from background script'));
            return;
          }

          if (!response.success) {
            reject(new Error(response.error || 'Ollama request failed'));
            return;
          }

          const output = (response.data?.response || '').trim();
          if (!output) {
            reject(new Error('Ollama returned empty response'));
            return;
          }
          
          resolve(output);
        }
      );
    });
  }
  
  // Fallback to direct fetch (for testing outside extension context)
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.1, // Low temperature for deterministic results
        num_predict: 100 // Limit response length
      }
    })
  });
  
  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return (data.response || '').trim();
}

/**
 * Call OpenAI API
 */
async function callOpenAIAPI(config: LLMConfig, prompt: string): Promise<string> {
  const apiUrl = config.apiUrl || 'https://api.openai.com/v1/chat/completions';
  const apiKey = config.apiKey;
  
  if (!apiKey) {
    throw new Error('OpenAI API key required');
  }
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a web content extraction expert. Return only CSS selectors, no explanations.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 50
    })
  });
  
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

/**
 * Call custom API (generic)
 */
async function callCustomAPI(config: LLMConfig, prompt: string): Promise<string> {
  const apiUrl = config.apiUrl;
  
  if (!apiUrl) {
    throw new Error('Custom API URL required');
  }
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({
      prompt: prompt,
      model: config.model
    })
  });
  
  if (!response.ok) {
    throw new Error(`Custom API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  // Try common response formats
  return (data.response || data.content || data.text || data.choices?.[0]?.text || '').trim();
}

/**
 * Extract CSS selector from LLM response
 */
function extractSelectorFromResponse(response: string): string | null {
  // Clean up the response - remove markdown, quotes, etc.
  let selector = response
    .replace(/```[a-z]*\n?/g, '') // Remove code blocks
    .replace(/`/g, '') // Remove backticks
    .replace(/^["']|["']$/g, '') // Remove quotes
    .trim();
  
  // Extract first line (selector should be on first line)
  selector = selector.split('\n')[0].trim();
  
  // Check if it's a sentence/explanation rather than a selector
  // If it contains common words that indicate it's not a selector, reject it
  const invalidPatterns = [
    /^(the|a|an|this|that|is|are|was|were|will|would|should|can|could|may|might)\s+/i,
    /^(main|content|area|section|element|page|website|site)\s+/i,
    /(is|are|was|were|will|would|should|can|could|may|might)\s+(the|a|an|this|that)/i,
    /\s+(is|are|was|were|will|would|should|can|could|may|might)\s+/i
  ];
  
  // If it matches invalid patterns (looks like a sentence), reject it
  if (invalidPatterns.some(pattern => pattern.test(selector))) {
    console.warn('[LLMContentExtraction] Response appears to be a sentence, not a selector:', selector);
    return null;
  }
  
  // Validate it looks like a CSS selector
  // Must start with #, ., [ or a letter (tag name)
  // Must not contain spaces in the middle (unless it's a descendant selector with > or +)
  if (selector && /^[#.a-z0-9\[\]:\s>+~_-]+$/i.test(selector)) {
    // Additional check: must start with valid selector characters
    if (/^[#.a-z\[\]_-]/i.test(selector)) {
      // Check if it's too long (likely a sentence)
      if (selector.length > 200) {
        console.warn('[LLMContentExtraction] Selector too long, likely not a valid selector:', selector.substring(0, 50));
        return null;
      }
      return selector;
    }
  }
  
  return null;
}

/**
 * Find main content using LLM
 */
export async function findMainContentByLLM(
  document: Document,
  config?: LLMConfig
): Promise<HTMLElement | null> {
  // Use provided config or get from storage
  const llmConfig = config || await getLLMConfig() || DEFAULT_CONFIG;
  
  if (!llmConfig.enabled) {
    return null;
  }
  
  try {
    console.log('[LLMContentExtraction] Using LLM to identify main content...');
    console.log('[LLMContentExtraction] Provider:', llmConfig.provider);
    console.log('[LLMContentExtraction] Model:', llmConfig.model);
    
    // Extract HTML structure
    const htmlStructure = extractHTMLStructure(document);
    if (!htmlStructure) {
      console.warn('[LLMContentExtraction] No HTML structure found');
      return null;
    }
    
    // Create prompt
    const prompt = createContentExtractionPrompt(htmlStructure, document.URL);
    
    // Call appropriate API
    let response: string;
    const timeout = llmConfig.timeout || DEFAULT_CONFIG.timeout!;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const provider = llmConfig.provider || DEFAULT_CONFIG.provider || 'transformers';
      switch (provider) {
        case 'transformers':
          response = await callTransformersAPI(llmConfig, prompt);
          break;
        case 'ollama':
          response = await callOllamaAPI(llmConfig, prompt);
          break;
        case 'openai':
          response = await callOpenAIAPI(llmConfig, prompt);
          break;
        case 'custom':
        default:
          response = await callCustomAPI(llmConfig, prompt);
          break;
      }
    } catch (error) {
      // If transformers fails, try API fallback if configured
      if (llmConfig.provider === 'transformers') {
        console.warn('[LLMContentExtraction] Local model failed, trying API fallback...');
        if (llmConfig.apiUrl) {
          try {
            // Try Ollama if apiUrl is configured
            if (llmConfig.apiUrl.includes('ollama') || llmConfig.apiUrl.includes('localhost')) {
              response = await callOllamaAPI({ ...llmConfig, provider: 'ollama' }, prompt);
            } else {
              response = await callCustomAPI({ ...llmConfig, provider: 'custom' }, prompt);
            }
          } catch (fallbackError) {
            console.error('[LLMContentExtraction] API fallback also failed:', fallbackError);
            throw error; // Throw original error
          }
        } else {
          throw error; // No fallback available
        }
      } else {
        throw error;
      }
    } finally {
      clearTimeout(timeoutId);
    }
    
    console.log('[LLMContentExtraction] LLM response:', response);
    
    // Extract selector from response
    const selector = extractSelectorFromResponse(response);
    if (!selector) {
      console.warn('[LLMContentExtraction] Could not extract valid selector from LLM response');
      return null;
    }
    
    console.log('[LLMContentExtraction] Extracted selector:', selector);
    
    // Try to find element using selector
    try {
      const element = document.querySelector(selector) as HTMLElement;
      if (element) {
        console.log('[LLMContentExtraction] ✅ Found main content via LLM:', element.tagName);
        return element;
      } else {
        console.warn('[LLMContentExtraction] Selector did not match any element:', selector);
        return null;
      }
    } catch (error) {
      console.error('[LLMContentExtraction] Invalid selector:', selector, error);
      return null;
    }
    
  } catch (error) {
    console.error('[LLMContentExtraction] LLM extraction failed:', error);
    console.warn('[LLMContentExtraction] Falling back to heuristics');
    return null;
  }
}

/**
 * Get LLM config from storage or environment
 */
export async function getLLMConfig(): Promise<LLMConfig> {
  // Try to get from Chrome storage first
  if (typeof chrome !== 'undefined' && chrome.storage) {
    try {
      const result = await chrome.storage.sync.get('llmConfig');
      if (result.llmConfig) {
        return { ...DEFAULT_CONFIG, ...result.llmConfig };
      }
    } catch (error) {
      console.warn('[LLMContentExtraction] Could not load config from storage:', error);
    }
  }
  
  // Try to get from localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = localStorage.getItem('llmConfig');
      if (stored) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.warn('[LLMContentExtraction] Could not load config from localStorage:', error);
    }
  }
  
  return DEFAULT_CONFIG;
}

/**
 * Save LLM config to storage
 */
export async function saveLLMConfig(config: LLMConfig): Promise<void> {
  // Ensure enabled is true when config is explicitly set (so it's used for both extraction and search/RAG)
  const configToSave: LLMConfig = {
    ...config,
    enabled: config.enabled !== undefined ? config.enabled : true
  };
  
  // Save to Chrome storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    try {
      await chrome.storage.sync.set({ llmConfig: configToSave });
      console.log('[LLMContentExtraction] Config saved to Chrome storage:', configToSave);
    } catch (error) {
      console.warn('[LLMContentExtraction] Could not save config to storage:', error);
    }
  }
  
  // Also save to localStorage as fallback
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem('llmConfig', JSON.stringify(configToSave));
      console.log('[LLMContentExtraction] Config saved to localStorage:', configToSave);
    } catch (error) {
      console.warn('[LLMContentExtraction] Could not save config to localStorage:', error);
    }
  }
}

