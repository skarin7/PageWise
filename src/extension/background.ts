/**
 * Background Service Worker
 */

import { LocalModelService } from '../core/LocalModelService';
import { CorpusStore } from '../core/CorpusStore';
import { CategoryEngine } from '../core/CategoryEngine';
import { EmbeddingService } from '../core/EmbeddingService';
import type { CorpusPage, CorpusChunk, CorpusTimeWindow } from '../types';

chrome.runtime.onInstalled.addListener((details) => {
  console.log('BrowseIQ extension installed');
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }
});

const corpusStore = CorpusStore.getInstance();

// CSP-blocked fetches reject with the same generic "TypeError: Failed to
// fetch" as a real network failure - there's no distinguishing error code.
// SecurityPolicyViolationEvent is the only reliable signal, so we record the
// last one and let error handlers check "did this just happen" to pick a
// useful message instead of a dead-end "failed to fetch".
let lastCspViolation: { blockedUri: string; violatedDirective: string; at: number } | null = null;

self.addEventListener('securitypolicyviolation', (event: any) => {
  lastCspViolation = {
    blockedUri: event.blockedURI,
    violatedDirective: event.violatedDirective,
    at: Date.now()
  };
  console.warn('[Background] CSP violation:', lastCspViolation);
});

function describeFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const isFetchFailure = message.includes('Failed to fetch') || message.includes('NetworkError');

  if (isFetchFailure && lastCspViolation && Date.now() - lastCspViolation.at < 5000) {
    return "Model download was blocked by the browser's security policy. This usually means the model provider changed servers and the extension needs an update. Try Chrome AI or Ollama in Settings instead, or check for a BrowseIQ update.";
  }

  return message;
}

// Handle long-lived connections for streaming
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ollama-stream') {
    port.onMessage.addListener((message) => {
      if (message.type === 'OLLAMA_STREAM_START') {
        handleOllamaStreamConnection(message.url, message.body, message.timeout, port);
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[Background] Ollama stream port disconnected');
    });
  }

  if (port.name === 'openai-stream') {
    port.onMessage.addListener((message) => {
      if (message.type === 'OPENAI_STREAM_START') {
        handleOpenAIStreamConnection(message.url, message.body, message.apiKey, message.timeout, port);
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[Background] OpenAI stream port disconnected');
    });
  }
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward messages between content script and popup
  if (message.type === 'FORWARD') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message.data, sendResponse);
      }
    });
    return true;
  }
  
  // Handle content script injection request from sidebar
  if (message.type === 'INJECT_CONTENT_SCRIPT' && message.tabId) {
    // Check if chrome.scripting is available
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      console.error('Background: chrome.scripting API not available');
      sendResponse({ success: false, error: 'chrome.scripting API not available' });
      return true;
    }
    
    chrome.scripting.executeScript({
      target: { tabId: message.tabId },
      files: ['content-script.js']
    }).then(() => {
      console.log('Background: Content script injected successfully');
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('Background: Failed to inject content script:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async response
  }
  
  // Handle streaming connection
  if (message.type === 'OLLAMA_STREAM_START') {
    const port = (sender as any).port || null;
    if (port) {
      handleOllamaStreamConnection(message.url, message.body, message.timeout, port);
    }
    return true;
  }
  
  // List models for a provider
  if (message.type === 'LIST_MODELS') {
    const { provider, apiUrl, apiKey, timeout } = message;
    
    if (provider === 'ollama') {
      // Handle Ollama model listing
      const listUrl = apiUrl ? apiUrl.replace('/api/generate', '/api/tags') : 'http://localhost:11434/api/tags';
      
      const controller = new AbortController();
      const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
      
      fetch(listUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      })
      .then(async (response) => {
        if (timeoutId) clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => response.statusText);
          sendResponse({ 
            success: false, 
            error: `Failed to list models: ${response.status} ${errorText}` 
          });
          return;
        }
        
        const data = await response.json();
        const models = data.models?.map((m: any) => ({ name: m.name, label: m.name })) || [];
        console.log('[Background] Ollama models fetched:', models);
        sendResponse({ success: true, models });
      })
      .catch(async (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        
        // Try XMLHttpRequest as fallback
        console.log('[Background] Fetch failed, trying XMLHttpRequest for model list...');
        try {
          const models = await new Promise<Array<{name: string, label: string}>>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', listUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = timeout || 10000;
            
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  const data = JSON.parse(xhr.responseText);
                  const models = data.models?.map((m: any) => ({ name: m.name, label: m.name })) || [];
                  resolve(models);
                } catch (e) {
                  const errorMessage = e instanceof Error ? e.message : String(e);
                  reject(new Error('Failed to parse response: ' + errorMessage));
                }
              } else {
                reject(new Error(`Ollama API error: ${xhr.status} ${xhr.statusText}`));
              }
            };
            
            xhr.onerror = () => {
              reject(new Error('Network error: Failed to connect to Ollama'));
            };
            
            xhr.ontimeout = () => {
              reject(new Error('Request timeout'));
            };
            
            xhr.send();
          });
          
          console.log('[Background] Ollama models fetched via XHR:', models);
          sendResponse({ success: true, models });
        } catch (xhrError) {
          console.error('[Background] Failed to list Ollama models:', xhrError);
          sendResponse({ 
            success: false, 
            error: xhrError instanceof Error ? xhrError.message : 'Failed to list models' 
          });
        }
      });
      
      return true; // Keep channel open for async response
    } else if (provider === 'openai' || provider === 'custom') {
      // Handle OpenAI-compatible API model listing
      const baseUrl = apiUrl || 'https://api.openai.com/v1';
      const listUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
      
      const controller = new AbortController();
      const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      
      fetch(listUrl, {
        method: 'GET',
        headers: headers,
        signal: controller.signal
      })
      .then(async (response) => {
        if (timeoutId) clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => response.statusText);
          sendResponse({ 
            success: false, 
            error: `Failed to list models: ${response.status} ${errorText}` 
          });
          return;
        }
        
        const data = await response.json();
        // OpenAI API returns { data: [{ id: "model-name", ... }] }
        const models = data.data?.map((m: any) => ({ 
          name: m.id, 
          label: m.id 
        })) || [];
        console.log('[Background] OpenAI-compatible models fetched:', models);
        sendResponse({ success: true, models });
      })
      .catch(async (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('[Background] Failed to list OpenAI-compatible models:', error);
        sendResponse({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed to list models' 
        });
      });
      
      return true; // Keep channel open for async response
    }
  }
  
  // Legacy: List Ollama models (for backward compatibility)
  if (message.type === 'OLLAMA_LIST_MODELS') {
    const { apiUrl, timeout } = message;
    const listUrl = apiUrl ? apiUrl.replace('/api/generate', '/api/tags') : 'http://localhost:11434/api/tags';
    
    const controller = new AbortController();
    const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    
    fetch(listUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    })
    .then(async (response) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        sendResponse({ 
          success: false, 
          error: `Failed to list models: ${response.status} ${errorText}` 
        });
        return;
      }
      
      const data = await response.json();
      const models = data.models?.map((m: any) => m.name) || [];
      console.log('[Background] Ollama models fetched:', models);
      sendResponse({ success: true, models });
    })
    .catch(async (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      // Try XMLHttpRequest as fallback
      console.log('[Background] Fetch failed, trying XMLHttpRequest for model list...');
      try {
        const models = await new Promise<string[]>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', listUrl, true);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.timeout = timeout || 10000;
          
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText);
                const models = data.models?.map((m: any) => m.name) || [];
                resolve(models);
              } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                reject(new Error('Failed to parse response: ' + errorMessage));
              }
            } else {
              reject(new Error(`Ollama API error: ${xhr.status} ${xhr.statusText}`));
            }
          };
          
          xhr.onerror = () => {
            reject(new Error('Network error: Failed to connect to Ollama'));
          };
          
          xhr.ontimeout = () => {
            reject(new Error('Request timeout'));
          };
          
          xhr.send();
        });
        
        console.log('[Background] Ollama models fetched via XHR:', models);
        sendResponse({ success: true, models });
      } catch (xhrError) {
        console.error('[Background] Failed to list Ollama models:', xhrError);
        sendResponse({ 
          success: false, 
          error: xhrError instanceof Error ? xhrError.message : 'Failed to list models' 
        });
      }
    });
    
    return true; // Keep channel open for async response
  }
  
  // Proxy Ollama API requests to avoid CORS issues
  if (message.type === 'OLLAMA_REQUEST') {
    const { url, body, timeout, stream } = message;
    
    // Handle streaming requests (legacy, use OLLAMA_STREAM_START instead)
    if (stream) {
      return handleOllamaStream(url, body, timeout, sendResponse);
    }
    
    // Use XMLHttpRequest as fallback if fetch is blocked by CSP
    const makeRequest = () => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = timeout || 30000;
        
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              resolve(data);
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              reject(new Error('Failed to parse response: ' + errorMessage));
            }
          } else {
            const errorDetail = xhr.responseText ? ` - ${xhr.responseText.substring(0, 200)}` : '';
            console.error('[Background] Ollama XHR error:', {
              status: xhr.status,
              statusText: xhr.statusText,
              responseText: xhr.responseText?.substring(0, 200),
              url,
              model: body.model
            });
            reject(new Error(`Ollama API error: ${xhr.status} ${xhr.statusText}${errorDetail}`));
          }
        };
        
        xhr.onerror = () => {
          reject(new Error('Network error: Failed to connect to Ollama'));
        };
        
        xhr.ontimeout = () => {
          reject(new Error('Request timeout'));
        };
        
        try {
          xhr.send(JSON.stringify(body));
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          reject(new Error('Failed to send request: ' + errorMessage));
        }
      });
    };
    
    // Try fetch first, fallback to XMLHttpRequest
    const controller = new AbortController();
    const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    
    // Log full request details for debugging
    const requestBody = JSON.stringify(body);
    console.log('[Background] Ollama request details:', {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      bodyString: requestBody
    });
    
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: requestBody,
      signal: controller.signal
    })
    .then(async (response) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        console.error('[Background] Ollama API error:', {
          status: response.status,
          statusText: response.statusText,
          errorText,
          url,
          model: body.model,
          requestBody: body
        });
        
        // If 403, try again with minimal request (no options)
        // Some Ollama versions/models reject requests with options
        if (response.status === 403) {
          console.log('[Background] Got 403, retrying with minimal request (no options)...');
          const minimalBody = {
            model: body.model,
            prompt: body.prompt,
            stream: false
          };
          
          // Create a new controller for retry (original might be aborted)
          const retryController = new AbortController();
          const retryTimeoutId = timeout ? setTimeout(() => retryController.abort(), timeout) : null;
          
          try {
            const retryResponse = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(minimalBody),
              signal: retryController.signal
            });
            
            if (retryTimeoutId) clearTimeout(retryTimeoutId);
            
            if (retryResponse.ok) {
              const retryData = await retryResponse.json();
              console.log('[Background] Minimal request succeeded!');
              sendResponse({ success: true, data: retryData });
              return;
            } else {
              const retryErrorText = await retryResponse.text().catch(() => retryResponse.statusText);
              console.error('[Background] Minimal request also failed:', {
                status: retryResponse.status,
                error: retryErrorText
              });
            }
          } catch (retryError) {
            if (retryTimeoutId) clearTimeout(retryTimeoutId);
            console.error('[Background] Retry request failed:', retryError);
          }
        }
        
        sendResponse({ 
          success: false, 
          error: `Ollama API error: ${response.status} ${errorText}` 
        });
        return;
      }
      
      const data = await response.json();
      console.log('[Background] Ollama response received:', {
        hasResponse: !!data.response,
        responseLength: data.response?.length || 0
      });
      sendResponse({ success: true, data });
    })
    .catch(async (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      // If fetch fails due to CSP, try XMLHttpRequest
      if (error.message && (error.message.includes('CSP') || error.message.includes('Content Security Policy'))) {
        console.log('[Background] Fetch blocked by CSP, trying XMLHttpRequest...');
        try {
          const data = await makeRequest();
          sendResponse({ success: true, data });
        } catch (xhrError) {
          console.error('[Background] XMLHttpRequest also failed:', xhrError);
          sendResponse({ 
            success: false, 
            error: xhrError instanceof Error ? xhrError.message : 'Request failed' 
          });
        }
      } else {
        console.error('[Background] Ollama proxy request failed:', error);
        sendResponse({ 
          success: false, 
          error: error.name === 'AbortError' ? 'Request timeout' : error.message 
        });
      }
    });
    
    return true; // Keep channel open for async response
  }
  
  // Handle OpenAI-compatible API requests
  if (message.type === 'OPENAI_REQUEST') {
    const { url, body, apiKey, timeout } = message;
    
    const controller = new AbortController();
    const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    .then(async (response) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        console.error('[Background] OpenAI-compatible API error:', {
          status: response.status,
          statusText: response.statusText,
          errorText,
          url
        });
        sendResponse({ 
          success: false, 
          error: `OpenAI-compatible API error: ${response.status} ${errorText}` 
        });
        return;
      }
      
      const data = await response.json();
      console.log('[Background] OpenAI-compatible response received');
      sendResponse({ success: true, data });
    })
    .catch((error) => {
      if (timeoutId) clearTimeout(timeoutId);
      console.error('[Background] OpenAI-compatible request failed:', error);
      sendResponse({ 
        success: false, 
        error: error.name === 'AbortError' ? 'Request timeout' : error.message 
      });
    });
    
    return true; // Keep channel open for async response
  }

  // --- Corpus (cross-page memory) handlers ---

  if (message.type === 'CORPUS_STORE_PAGE') {
    const { page, chunks } = message as { page: CorpusPage; chunks: CorpusChunk[] };
    (async () => {
      try {
        const categories = await corpusStore.getAllCategories();
        const { categoryId, categories: updatedCategories } = CategoryEngine.assignCategory(
          page,
          chunks,
          categories
        );
        page.categoryId = categoryId;

        await corpusStore.storePage(page, chunks);
        for (const category of updatedCategories) {
          await corpusStore.putCategory(category);
        }

        sendResponse({ success: true });
      } catch (error) {
        console.error('[Background] CORPUS_STORE_PAGE failed:', error);
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'CORPUS_SEARCH') {
    const { query, limit, threshold } = message as { query: string; limit?: number; threshold?: number };
    (async () => {
      try {
        const embedder = EmbeddingService.getInstance();
        await embedder.init();
        const queryEmbedding = await embedder.embed(query);
        const results = await corpusStore.searchWithEmbedding(query, queryEmbedding, { limit, threshold });
        sendResponse({ success: true, results });
      } catch (error) {
        console.error('[Background] CORPUS_SEARCH failed:', error);
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'CORPUS_LIST') {
    const { window, categoryId } = message as { window?: CorpusTimeWindow; categoryId?: string };
    (async () => {
      try {
        const pages = await corpusStore.listPages(window || 'all', categoryId);
        const categories = await corpusStore.getAllCategories();
        sendResponse({ success: true, pages, categories });
      } catch (error) {
        console.error('[Background] CORPUS_LIST failed:', error);
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'CORPUS_DELETE_PAGE') {
    const { url } = message as { url: string };
    (async () => {
      try {
        await corpusStore.deletePage(url);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'CORPUS_CLEAR') {
    (async () => {
      try {
        await corpusStore.clearAll();
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'CORPUS_STATS') {
    (async () => {
      try {
        const stats = await corpusStore.getStorageStats();
        sendResponse({ success: true, stats });
      } catch (error) {
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  // Reading history lives in extension-origin IndexedDB, which Chrome wipes
  // on uninstall/reinstall. Export/import is the only way it survives that.
  if (message.type === 'CORPUS_EXPORT') {
    (async () => {
      try {
        const snapshot = await corpusStore.exportAll();
        sendResponse({ success: true, snapshot });
      } catch (error) {
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'CORPUS_IMPORT') {
    const { snapshot } = message as { snapshot: { pages: CorpusPage[]; chunks: CorpusChunk[]; categories: any[] } };
    (async () => {
      try {
        await corpusStore.importAll(snapshot);
        const stats = await corpusStore.getStorageStats();
        sendResponse({ success: true, stats });
      } catch (error) {
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  // Run Transformers.js (WASM) generation here in the background service worker
  // so the content script's main thread — and the tab — stays responsive.
  if (message.type === 'TRANSFORMERS_GENERATE') {
    const { prompt, modelName, options } = message;
    (async () => {
      try {
        const llm = LocalModelService.getInstance({
          provider: 'transformers',
          modelName: modelName || 'Xenova/LaMini-Flan-T5-783M',
          requestTimeoutMs: 120_000,
        });
        await llm.init();
        const result = await llm.generate(prompt, options);
        sendResponse({ success: true, result });
      } catch (error) {
        const msg = describeFetchError(error);
        console.error('[Background] TRANSFORMERS_GENERATE failed:', msg);
        sendResponse({ success: false, error: msg });
      }
    })();
    return true; // Keep channel open for async response
  }

  // First-run onboarding: pre-download the generation model so the user's
  // first real question doesn't stall on a ~300MB fetch. Progress is
  // broadcast so the options page (or any listener) can show a bar.
  if (message.type === 'DOWNLOAD_GENERATION_MODEL') {
    const { modelName } = message as { modelName?: string };
    (async () => {
      try {
        const llm = LocalModelService.getInstance({
          provider: 'transformers',
          modelName: modelName || 'Xenova/LaMini-Flan-T5-783M',
          requestTimeoutMs: 300_000,
        });
        await llm.init((percent) => {
          chrome.runtime.sendMessage({ type: 'MODEL_DOWNLOAD_PROGRESS', model: 'generation', percent }).catch(() => {});
        });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: describeFetchError(error) });
      }
    })();
    return true;
  }
});

// Handle streaming Ollama requests via long-lived connection
async function handleOllamaStreamConnection(
  url: string,
  body: any,
  timeout: number | undefined,
  port: chrome.runtime.Port
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
  
  try {
    const streamBody = { ...body, stream: true };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(streamBody),
      signal: controller.signal
    });
    
    if (timeoutId) clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      port.postMessage({ 
        success: false, 
        error: `Ollama API error: ${response.status} ${errorText}` 
      });
      port.disconnect();
      return;
    }
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    if (!reader) {
      port.postMessage({ success: false, error: 'Stream not available' });
      port.disconnect();
      return;
    }
    
    let buffer = '';
    let fullResponse = '';
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        port.postMessage({ success: true, chunk: '', done: true, fullResponse });
        port.disconnect();
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            if (data.response) {
              fullResponse += data.response;
              port.postMessage({ 
                success: true, 
                chunk: data.response,
                done: data.done || false
              });
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error('[Background] Ollama stream error:', error);
    port.postMessage({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Stream failed' 
    });
    port.disconnect();
  }
}

async function handleOpenAIStreamConnection(
  url: string,
  body: any,
  apiKey: string,
  timeout: number | undefined,
  port: chrome.runtime.Port
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: controller.signal
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      port.postMessage({ error: `OpenAI API error: ${response.status} ${errorText}` });
      port.disconnect();
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      port.postMessage({ error: 'Stream not available' });
      port.disconnect();
      return;
    }

    let buffer = '';
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        port.postMessage({ chunk: '', done: true, fullResponse });
        port.disconnect();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              fullResponse += delta;
              port.postMessage({ chunk: delta, done: false });
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    port.postMessage({ error: error instanceof Error ? error.message : 'Stream failed' });
    port.disconnect();
  }
}

// Handle streaming Ollama requests (legacy callback-based)
async function handleOllamaStream(
  url: string,
  body: any,
  timeout: number | undefined,
  sendResponse: (response: any) => void
): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
  
  try {
    // Set stream to true for streaming response
    const streamBody = { ...body, stream: true };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(streamBody),
      signal: controller.signal
    });
    
    if (timeoutId) clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      sendResponse({ 
        success: false, 
        error: `Ollama API error: ${response.status} ${errorText}` 
      });
      return true;
    }
    
    // Handle streaming response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    if (!reader) {
      sendResponse({ success: false, error: 'Stream not available' });
      return true;
    }
    
    let buffer = '';
    let fullResponse = '';
    
    // Send initial response to indicate streaming started
    sendResponse({ success: true, streaming: true, chunk: '' });
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        // Send final chunk
        sendResponse({ success: true, streaming: true, chunk: '', done: true, fullResponse });
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            if (data.response) {
              fullResponse += data.response;
              // Send each chunk
              sendResponse({ 
                success: true, 
                streaming: true, 
                chunk: data.response,
                done: data.done || false
              });
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
    }
    
    return true; // Keep channel open for streaming
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error('[Background] Ollama stream error:', error);
    sendResponse({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Stream failed' 
    });
    return true;
  }
}

// Handle keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-sidebar') {
    // Get active tab and toggle sidebar
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_SIDEBAR' });
      }
    });
  }
});

