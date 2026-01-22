/**
 * Persistent sidebar overlay for query interface
 * This stays open even when clicking elsewhere on the page
 */

// Export LLM config helpers IMMEDIATELY (before DOMContentLoaded)
// These functions are available when you open the sidebar console

// Define the functions
const configureLLMExtractionFn = async (config: any) => {
  try {
    const { saveLLMConfig } = await import('../../utils/llmContentExtraction');
    await saveLLMConfig(config);
    console.log('✅ LLM config saved. Reload page to apply.');
    console.log('Config:', config);
  } catch (error) {
    console.error('Failed to save LLM config:', error);
    // Fallback: save directly to localStorage
    localStorage.setItem('llmConfig', JSON.stringify(config));
    console.log('✅ Config saved to localStorage as fallback. Reload page to apply.');
  }
};

const getLLMConfigFn = async () => {
  try {
    const { getLLMConfig } = await import('../../utils/llmContentExtraction');
    return await getLLMConfig();
  } catch (error) {
    console.error('Failed to get LLM config:', error);
    // Fallback: get from localStorage
    const stored = localStorage.getItem('llmConfig');
    if (stored) {
      return JSON.parse(stored);
    }
    return null;
  }
};

// Attach to window
(window as any).configureLLMExtraction = configureLLMExtractionFn;
(window as any).getLLMConfig = getLLMConfigFn;

// Also make them available as global variables (for console access)
// Use Object.defineProperty to ensure they're truly global
try {
  Object.defineProperty(window, 'configureLLMExtraction', {
    value: configureLLMExtractionFn,
    writable: true,
    configurable: true,
    enumerable: true
  });
  
  Object.defineProperty(window, 'getLLMConfig', {
    value: getLLMConfigFn,
    writable: true,
    configurable: true,
    enumerable: true
  });
} catch (e) {
  // If defineProperty fails, the assignment above should still work
  console.warn('Could not use defineProperty:', e);
}

// Verify functions are available
const testConfigure = typeof (window as any).configureLLMExtraction === 'function';
const testGet = typeof (window as any).getLLMConfig === 'function';

if (testConfigure) {
  console.log('✅ configureLLMExtraction is available');
} else {
  console.error('❌ configureLLMExtraction is NOT available');
}

if (testGet) {
  console.log('✅ getLLMConfig is available');
} else {
  console.error('❌ getLLMConfig is NOT available');
}

// Also attach to globalThis, self, and top-level scope as fallbacks
if (typeof globalThis !== 'undefined') {
  (globalThis as any).configureLLMExtraction = (window as any).configureLLMExtraction;
  (globalThis as any).getLLMConfig = (window as any).getLLMConfig;
}

if (typeof self !== 'undefined') {
  (self as any).configureLLMExtraction = (window as any).configureLLMExtraction;
  (self as any).getLLMConfig = (window as any).getLLMConfig;
}

// Make them available on globalThis and self as well
if (typeof globalThis !== 'undefined') {
  (globalThis as any).configureLLMExtraction = configureLLMExtractionFn;
  (globalThis as any).getLLMConfig = getLLMConfigFn;
}

if (typeof self !== 'undefined' && self !== window) {
  (self as any).configureLLMExtraction = configureLLMExtractionFn;
  (self as any).getLLMConfig = getLLMConfigFn;
}

// Settings Modal Functions
async function openSettings() {
  if (settingsModal) {
    await loadSettings();
    settingsModal.classList.add('show');
  }
}

function closeSettings() {
  if (settingsModal) {
    settingsModal.classList.remove('show');
  }
}

async function loadSettings() {
  try {
    console.log('[Settings] Loading current LLM configuration...');
    const config = await getLLMConfigFn();
    console.log('[Settings] Loaded config:', config);
    
    // Determine mode (derive from agentMode if mode not set for backward compatibility)
    const mode = config?.mode || (config?.agentMode ? 'online' : 'offline');
    const provider = config?.provider || 'transformers';
    
    // Set mode selector
    if (modeSelect) {
      modeSelect.value = mode;
    }
    
    // Set provider based on mode
    if (mode === 'offline') {
      // Offline mode: show offline provider selector
      if (offlineProviderSelect) {
        // Map provider to offline options
        if (provider === 'transformers' || provider === 'ollama') {
          offlineProviderSelect.value = provider;
        } else {
          offlineProviderSelect.value = 'transformers'; // Default for offline
        }
      }
      
      // Set offline Ollama config if applicable
      if (provider === 'ollama' && offlineOllamaUrlInput) {
        offlineOllamaUrlInput.value = config?.apiUrl || 'http://localhost:11434';
      }
      
      if (offlineTimeoutInput) {
        offlineTimeoutInput.value = config?.timeout?.toString() || '30000';
      }
      
      // Set model in offline model select
      if (config?.model && offlineModelSelect) {
        setTimeout(() => {
          offlineModelSelect.value = config.model;
        }, 1500);
      }
    } else {
      // Online mode: show online provider selector
      if (onlineProviderSelect) {
        // Map provider to online options (openrouter is new)
        if (provider === 'openrouter') {
          onlineProviderSelect.value = 'openrouter';
        } else if (provider === 'openai' || provider === 'custom' || provider === 'ollama') {
          onlineProviderSelect.value = provider;
        } else {
          onlineProviderSelect.value = 'ollama'; // Default for online
        }
      }
      
      // Set online provider config
      if (onlineApiUrlInput && (provider === 'ollama' || provider === 'custom')) {
        onlineApiUrlInput.value = config?.apiUrl || (provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1');
      }
      
      if (providerTokenInput && config?.apiKey) {
        providerTokenInput.value = config.apiKey;
      }
      
      if (onlineTimeoutInput) {
        onlineTimeoutInput.value = config?.timeout?.toString() || '30000';
      }
      
      // Set web search config (optional)
      if (webSearchProviderSelect) {
        const webSearchProvider = config?.webSearchProvider || 'ollama';
        webSearchProviderSelect.value = webSearchProvider;
      }
      
      // Set web search API key
      if (webSearchApiKeyInput) {
        if (config?.webSearchApiKey) {
          webSearchApiKeyInput.value = config.webSearchApiKey;
        }
      }
      
      if (maxToolStepsInput) {
        maxToolStepsInput.value = config?.maxToolSteps?.toString() || '3';
      }
      
      // Set model in online model select
      if (config?.model && onlineModelSelect) {
        setTimeout(() => {
          onlineModelSelect.value = config.model;
        }, 1500);
      }
    }
    
    // Update visibility based on mode
    updateModeVisibility();
    
    // Update web search provider options after loading settings
    // This ensures Ollama is filtered out if main provider is Ollama
    if (mode === 'online') {
      updateOnlineProviderConfig();
    }
    
    // Update Transformers.js info banner
    updateTransformersInfoBanner();
    
    console.log('[Settings] Settings loaded successfully');
  } catch (error) {
    console.error('[Settings] Failed to load settings:', error);
    // Set defaults on error
    if (modeSelect) modeSelect.value = 'offline';
    if (offlineProviderSelect) offlineProviderSelect.value = 'transformers';
    updateModeVisibility();
  }
}

/**
 * Update visibility based on mode selection (offline vs online)
 */
function updateModeVisibility() {
  if (!modeSelect || !offlineModeConfig || !onlineModeConfig) return;
  
  const mode = modeSelect.value as 'offline' | 'online';
  
  if (mode === 'offline') {
    offlineModeConfig.style.display = 'block';
    onlineModeConfig.style.display = 'none';
  } else {
    offlineModeConfig.style.display = 'none';
    onlineModeConfig.style.display = 'block';
    // Web search config visibility is handled by updateOnlineProviderConfig()
    // Don't force-show it here - let the provider-specific logic decide
  }
  
  // Update provider-specific configs based on mode
  if (mode === 'offline') {
    updateOfflineProviderConfig();
  } else {
    updateOnlineProviderConfig();
  }
}

/**
 * Update offline provider configuration visibility
 */
function updateOfflineProviderConfig() {
  if (!offlineProviderSelect || !offlineOllamaConfig) return;
  
  const provider = offlineProviderSelect.value;
  
  if (provider === 'ollama') {
    offlineOllamaConfig.style.display = 'block';
    // Fetch models for Ollama
    if (offlineOllamaUrlInput) {
      fetchModelsForProvider('ollama', offlineOllamaUrlInput.value, undefined, offlineModelSelect, offlineModelStatus);
    }
  } else {
    offlineOllamaConfig.style.display = 'none';
  }
}

/**
 * Update online provider configuration visibility and token inputs
 */
function updateOnlineProviderConfig() {
  if (!onlineProviderSelect || !onlineProviderConfigGroup) return;
  
  const provider = onlineProviderSelect.value;
  
  // Always show provider config group in online mode
  onlineProviderConfigGroup.style.display = 'block';
  
  // Show/hide API URL based on provider
  if (onlineApiUrlGroup) {
    if (provider === 'ollama' || provider === 'custom') {
      onlineApiUrlGroup.style.display = 'block';
      if (onlineApiUrlHelp) {
        if (provider === 'ollama') {
          onlineApiUrlHelp.textContent = 'Ollama server base URL. Can be localhost (http://localhost:11434) or remote server.';
        } else {
          onlineApiUrlHelp.textContent = 'Custom API base URL (e.g., https://api.example.com/v1)';
        }
      }
    } else {
      onlineApiUrlGroup.style.display = 'none';
    }
  }
  
  // Show provider token input for all online providers
  if (providerTokenGroup && providerTokenInput && providerTokenLabel && providerTokenHelp) {
    providerTokenGroup.style.display = 'block';
    
    // Update label and help text based on provider
    switch (provider) {
      case 'ollama':
        providerTokenLabel.textContent = 'Ollama API Token (for Web Search)';
        providerTokenInput.placeholder = 'Enter Ollama API token from ollama.com';
        providerTokenHelp.textContent = 'Required for Ollama web search. Get free API key from ollama.com (free account required).';
        break;
      case 'openai':
        providerTokenLabel.textContent = 'OpenAI API Key';
        providerTokenInput.placeholder = 'Enter OpenAI API key';
        providerTokenHelp.textContent = 'Get your API key from platform.openai.com';
        break;
      case 'openrouter':
        providerTokenLabel.textContent = 'OpenRouter API Key';
        providerTokenInput.placeholder = 'Enter OpenRouter API key';
        providerTokenHelp.textContent = 'Get your API key from openrouter.ai';
        break;
      case 'custom':
        providerTokenLabel.textContent = 'API Key';
        providerTokenInput.placeholder = 'Enter API key for your service';
        providerTokenHelp.textContent = 'API key for your OpenAI-compatible service';
        break;
    }
  }
  
  // Update web search provider options based on main provider
  if (webSearchConfig && webSearchProviderSelect) {
    // Hide web search config when main provider is Ollama (token is already in provider token field)
    if (provider === 'ollama') {
      webSearchConfig.style.display = 'none';
    } else {
      // Show web search config for other providers
      webSearchConfig.style.display = 'block';
      
      // Always show the web search provider selector (web search is optional)
      const webSearchProviderGroup = webSearchProviderSelect.closest('.form-group') as HTMLElement;
      if (webSearchProviderGroup) {
        webSearchProviderGroup.style.display = 'block';
      }
      
      // Show all options including Ollama (users can choose any provider)
      const allOptions = Array.from(webSearchProviderSelect.options) as HTMLOptionElement[];
      allOptions.forEach(option => {
        option.style.display = 'block';
        option.disabled = false;
      });
      
      // Update web search API key label based on selected web search provider
      const selectedWebSearchProvider = webSearchProviderSelect.value;
      const webSearchApiKeyLabel = document.querySelector('label[for="web-search-api-key"]') as HTMLLabelElement;
      const webSearchApiKeyInput = document.getElementById('web-search-api-key') as HTMLInputElement;
      
      if (webSearchApiKeyLabel && webSearchApiKeyInput) {
        if (selectedWebSearchProvider === 'ollama') {
          webSearchApiKeyLabel.textContent = 'Ollama API Token (for Web Search)';
          webSearchApiKeyInput.placeholder = 'Enter Ollama API token from ollama.com';
        } else {
          webSearchApiKeyLabel.textContent = 'Web Search API Key';
          webSearchApiKeyInput.placeholder = 'Enter API key for search provider';
        }
      }
    }
  }
  
  // Fetch models for the selected provider
  const apiUrl = onlineApiUrlInput?.value || (provider === 'ollama' ? 'http://localhost:11434' : undefined);
  const apiKey = providerTokenInput?.value;
  fetchModelsForProvider(provider, apiUrl, apiKey, onlineModelSelect, onlineModelStatus);
}

/**
 * Legacy function - kept for backward compatibility but no longer used
 */
function updateAgentConfigVisibility() {
  // This function is deprecated - mode visibility is now handled by updateModeVisibility()
  // Keeping for backward compatibility in case any code still references it
}

async function updateTransformersInfoBanner() {
  const transformersInfoBanner = document.getElementById('transformers-info-banner');
  if (!transformersInfoBanner) return;
  
  // Check if user dismissed the banner
  const dismissed = localStorage.getItem('transformers-info-banner-dismissed') === 'true';
  if (dismissed) {
    transformersInfoBanner.style.display = 'none';
    return;
  }
  
  // Check current provider
  try {
    const config = await getLLMConfigFn();
    const provider = config?.provider || 'transformers';
    
    if (provider === 'transformers') {
      transformersInfoBanner.style.display = 'block';
    } else {
      transformersInfoBanner.style.display = 'none';
    }
  } catch (error) {
    // Default to showing if we can't determine provider
    transformersInfoBanner.style.display = 'block';
  }
}

function updateProviderConfigVisibility() {
  if (!providerSelect || !providerConfigGroup) return;
  
  const provider = providerSelect.value;
  
  if (provider === 'transformers') {
    // Hide all provider-specific config for transformers (default)
    providerConfigGroup.style.display = 'none';
  } else {
    // Show provider-specific config
    providerConfigGroup.style.display = 'block';
    
    // Update API URL field based on provider
    if (apiUrlGroup && apiUrlInput && apiUrlHelp) {
      if (provider === 'ollama') {
        apiUrlGroup.style.display = 'block';
        if (apiUrlLabel) apiUrlLabel.textContent = 'API URL';
        apiUrlInput.placeholder = 'http://localhost:11434';
        apiUrlHelp.textContent = 'Ollama server base URL. Set to: http://localhost:11434 (or your Ollama server address). The code will automatically use /api/chat for agent mode or /api/generate for regular mode.';
        // Set default if empty
        if (!apiUrlInput.value || apiUrlInput.value === 'https://api.openai.com/v1') {
          apiUrlInput.value = 'http://localhost:11434';
        }
      } else if (provider === 'openai') {
        apiUrlGroup.style.display = 'block';
        if (apiUrlLabel) apiUrlLabel.textContent = 'Base URL';
        apiUrlInput.placeholder = 'https://api.openai.com/v1';
        apiUrlHelp.textContent = 'OpenAI API base URL (default: https://api.openai.com/v1)';
        // Set default if empty
        if (!apiUrlInput.value || apiUrlInput.value === 'http://localhost:11434' || apiUrlInput.value === 'http://localhost:11434/api' || apiUrlInput.value === 'http://localhost:11434/api/generate') {
          apiUrlInput.value = 'https://api.openai.com/v1';
        }
      } else if (provider === 'custom') {
        apiUrlGroup.style.display = 'block';
        if (apiUrlLabel) apiUrlLabel.textContent = 'Base URL';
        apiUrlInput.placeholder = 'https://your-api.com/v1';
        apiUrlHelp.textContent = 'Custom OpenAI-compatible API base URL (must end with /v1)';
        // Set default if empty
        if (!apiUrlInput.value || apiUrlInput.value === 'http://localhost:11434' || apiUrlInput.value === 'http://localhost:11434/api' || apiUrlInput.value === 'http://localhost:11434/api/generate') {
          apiUrlInput.value = 'https://api.openai.com/v1';
        }
      }
    }
    
    // Show/hide API key field
    if (apiKeyGroup) {
      if (provider === 'ollama') {
        apiKeyGroup.style.display = 'none';
      } else {
        apiKeyGroup.style.display = 'block';
        if (apiKeyHelp) {
          if (provider === 'openai') {
            apiKeyHelp.textContent = 'Your OpenAI API key (starts with sk-)';
          } else {
            apiKeyHelp.textContent = 'API key for your custom OpenAI-compatible service';
          }
        }
      }
    }
    
    // Fetch models for the selected provider
    fetchProviderModels();
  }
}

/**
 * Fetch models for a provider (works with any model select element)
 */
async function fetchModelsForProvider(
  provider: string,
  apiUrl?: string,
  apiKey?: string,
  modelSelectElement?: HTMLSelectElement,
  modelStatusElement?: HTMLElement,
  timeout?: number
) {
  const targetModelSelect = modelSelectElement || modelSelect;
  const targetModelStatus = modelStatusElement || modelStatus;
  
  if (!targetModelSelect) return;
  
  if (provider === 'transformers') {
    return; // No models to fetch for transformers
  }
  
  // Set defaults based on provider
  if (!apiUrl) {
    if (provider === 'ollama') {
      apiUrl = 'http://localhost:11434';
    } else if (provider === 'openai' || provider === 'openrouter') {
      apiUrl = 'https://api.openai.com/v1';
    } else if (provider === 'custom') {
      apiUrl = 'https://api.openai.com/v1';
    }
  }
  
  const requestTimeout = timeout || parseInt(timeoutInput?.value || '10000', 10);
  
  // Show loading state
  targetModelSelect.innerHTML = '<option value="">Loading models...</option>';
  targetModelSelect.disabled = true;
  if (targetModelStatus) {
    targetModelStatus.textContent = `Fetching available models from ${provider}...`;
    targetModelStatus.style.color = '#666';
  }
  
  try {
    const response = await new Promise<{ success: boolean; models?: Array<{name: string, label: string}>; error?: string }>((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'LIST_MODELS',
          provider: provider,
          apiUrl: apiUrl,
          apiKey: apiKey,
          timeout: requestTimeout
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: 'No response' });
          }
        }
      );
    });
    
    if (response.success && response.models && response.models.length > 0) {
      // Populate dropdown with models
      targetModelSelect.innerHTML = '<option value="">Select a model...</option>';
      response.models.forEach((model) => {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = model.label || model.name;
        targetModelSelect.appendChild(option);
      });
      
      targetModelSelect.disabled = false;
      if (targetModelStatus) {
        targetModelStatus.textContent = `${response.models.length} model(s) available`;
        targetModelStatus.style.color = '#4caf50';
      }
      
      // If we have a saved model, select it
      const savedConfig = await getLLMConfigFn();
      if (savedConfig && savedConfig.model) {
        const matchingModel = response.models.find(m => m.name === savedConfig.model);
        if (matchingModel) {
          targetModelSelect.value = savedConfig.model;
        }
      }
    } else {
      targetModelSelect.innerHTML = '<option value="">No models found</option>';
      targetModelSelect.disabled = false;
      if (targetModelStatus) {
        const errorMsg = response.error || `No models available. Make sure ${provider} is configured correctly.`;
        targetModelStatus.textContent = errorMsg;
        targetModelStatus.style.color = '#f44336';
      }
    }
  } catch (error) {
    console.error('[Settings] Failed to fetch models:', error);
    targetModelSelect.innerHTML = '<option value="">Error loading models</option>';
    targetModelSelect.disabled = false;
    if (targetModelStatus) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      targetModelStatus.textContent = `Error: ${errorMessage}. Check your configuration.`;
      targetModelStatus.style.color = '#f44336';
    }
  }
}

/**
 * Legacy function - kept for backward compatibility
 */
async function fetchProviderModels() {
  // Use the new fetchModelsForProvider with legacy elements
  const provider = providerSelect?.value || 'transformers';
  const apiUrl = apiUrlInput?.value?.trim();
  const apiKey = apiKeyInput?.value?.trim();
  await fetchModelsForProvider(provider, apiUrl, apiKey, modelSelect, modelStatus);
}

/**
 * Check if it's first time use and open settings automatically
 */
async function checkFirstTimeAndOpenSettings(): Promise<boolean> {
  try {
    // Check if user has configured settings before
    const result = await chrome.storage.local.get('rag_settings_configured');
    
    if (!result.rag_settings_configured) {
      // Check if config exists and is customized (not just default)
      const config = await getLLMConfigFn().catch(() => null);
      
      // Consider it first time if:
      // 1. No configured flag exists, AND
      // 2. Config is default or doesn't have a model selected
      const isFirstTime = !config || 
                         !config.model || 
                         (config.provider === 'transformers' && config.model === 'Xenova/LaMini-Flan-T5-783M' && !config.enabled);
      
      if (isFirstTime) {
        console.log('[Sidebar] First time use detected - opening settings automatically');
        // Open settings immediately and synchronously show the modal
        // This prevents focus on search input
        if (settingsModal) {
          // Show modal immediately (before loadSettings completes)
          settingsModal.classList.add('show');
          // Load settings in the background
          loadSettings().catch(err => console.warn('[Sidebar] Failed to load settings:', err));
        } else {
          // Fallback: use openSettings if modal not ready
          await openSettings();
        }
        return true; // Return true to indicate first time
      }
    }
    return false; // Not first time
  } catch (error) {
    console.warn('[Sidebar] Error checking first time use:', error);
    // Don't block sidebar if check fails
    return false;
  }
}

async function saveSettings() {
  try {
    if (!modeSelect) {
      console.error('[Settings] Mode selector not found');
      return;
    }
    
    const mode = modeSelect.value as 'offline' | 'online';
    let config: any = {
      enabled: true,
      mode: mode,
      agentMode: mode === 'online' // Derive agentMode from mode
    };
    
    if (mode === 'offline') {
      // Offline mode configuration
      const provider = offlineProviderSelect?.value || 'transformers';
      config.provider = provider;
      
      if (provider === 'transformers') {
        config.model = 'Xenova/LaMini-Flan-T5-783M'; // Default transformer model
      } else if (provider === 'ollama') {
        const model = offlineModelSelect?.value?.trim();
        if (!model) {
          alert('Please select an Ollama model from the dropdown');
          return;
        }
        config.model = model;
        config.apiUrl = offlineOllamaUrlInput?.value?.trim() || 'http://localhost:11434';
        config.timeout = parseInt(offlineTimeoutInput?.value || '30000', 10);
      }
    } else {
      // Online mode configuration
      const provider = onlineProviderSelect?.value || 'ollama';
      config.provider = provider;
      
      const model = onlineModelSelect?.value?.trim();
      if (!model) {
        alert(`Please select a model from the dropdown for ${provider}`);
        return;
      }
      config.model = model;
      config.timeout = parseInt(onlineTimeoutInput?.value || '30000', 10);
      
      // Provider-specific configuration
      if (provider === 'ollama') {
        config.apiUrl = onlineApiUrlInput?.value?.trim() || 'http://localhost:11434';
        // Ollama API token is for web search, not for LLM (can use localhost)
        // Automatically enable web search if API token is provided
        const ollamaApiToken = providerTokenInput?.value?.trim();
        if (ollamaApiToken) {
          // Auto-enable Ollama web search when token is provided
          config.webSearchProvider = 'ollama';
          config.webSearchApiKey = ollamaApiToken;
        }
      } else if (provider === 'openai') {
        config.apiUrl = 'https://api.openai.com/v1';
        const apiKey = providerTokenInput?.value?.trim();
        if (!apiKey) {
          alert('OpenAI API key is required for online mode');
          return;
        }
        config.apiKey = apiKey;
      } else if (provider === 'openrouter') {
        config.apiUrl = 'https://openrouter.ai/api/v1';
        const apiKey = providerTokenInput?.value?.trim();
        if (!apiKey) {
          alert('OpenRouter API key is required for online mode');
          return;
        }
        config.apiKey = apiKey;
      } else if (provider === 'custom') {
        const apiUrl = onlineApiUrlInput?.value?.trim();
        if (!apiUrl) {
          alert('Base URL is required for custom API');
          return;
        }
        config.apiUrl = apiUrl;
        const apiKey = providerTokenInput?.value?.trim();
        if (!apiKey) {
          alert('API key is required for custom API');
          return;
        }
        config.apiKey = apiKey;
      }
      
      // Web search configuration (optional for online mode)
      config.maxToolSteps = parseInt(maxToolStepsInput?.value || '3', 10);
      
      // For Ollama, web search is already configured above using provider token
      // For other providers, get web search config from the form (if section is visible)
      if (provider !== 'ollama') {
        // Get web search provider (optional)
        const webSearchProvider = webSearchProviderSelect?.value;
        const webSearchApiKey = webSearchApiKeyInput?.value?.trim();
        
        // Only configure web search if both provider and API key are provided
        if (webSearchProvider && webSearchApiKey) {
          config.webSearchProvider = webSearchProvider;
          config.webSearchApiKey = webSearchApiKey;
        } else {
          // Web search is optional - don't configure it if not provided
          config.webSearchProvider = undefined;
          config.webSearchApiKey = undefined;
        }
      }
      // For Ollama, web search config is already set above if token is provided
    }
    
    await configureLLMExtractionFn(config);
    
    // Mark that settings have been configured
    try {
      await chrome.storage.local.set({ rag_settings_configured: true });
      console.log('[Settings] Marked settings as configured');
    } catch (e) {
      console.warn('[Settings] Failed to save configured flag:', e);
    }
    
    // Show success message
    const saveButton = document.getElementById('settings-save') as HTMLButtonElement;
    if (saveButton) {
      const originalText = saveButton.textContent;
      saveButton.textContent = '✓ Saved!';
      saveButton.style.background = '#4caf50';
      setTimeout(() => {
        saveButton.textContent = originalText;
        saveButton.style.background = '';
      }, 2000);
    }
    
    // Close modal after a short delay
    setTimeout(() => {
      closeSettings();
      
      // If this was first time setup, trigger RAG initialization in content script
      // This will extract content and generate embeddings
      if (currentTabId) {
        setStatus('⏳ Initializing (extracting content and generating embeddings)...', 'loading');
        searchButton.disabled = true;
        
        chrome.tabs.sendMessage(currentTabId, { 
          type: 'INITIALIZE_RAG_AFTER_SETTINGS' 
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('[Settings] Content script may not be ready yet, RAG will initialize on first search');
            setStatus('⚠️ Content script not ready - will initialize on first search', 'error');
            searchButton.disabled = false;
          } else if (response?.success) {
            console.log('[Settings] RAG initialization triggered');
            // Update status after initialization
            setTimeout(() => {
              updateStatus();
            }, 2000);
          } else {
            setStatus('⚠️ RAG initialization failed - check console', 'error');
            searchButton.disabled = false;
          }
        });
      }
    }, 1500);
  } catch (error) {
    console.error('Failed to save settings:', error);
    alert('Failed to save settings. Please check the console for details.');
  }
}

// Direct test - try calling getLLMConfig to see if it works
(async () => {
  console.log('');
  console.log('🧪 Testing getLLMConfig...');
  try {
    const testResult = await (window as any).getLLMConfig();
    console.log('✅ Test successful! Current config:', testResult);
    console.log('');
    console.log('%c💡 How to use in console:', 'color: #28a745; font-weight: bold;');
    console.log('   1. Type: await getLLMConfig()');
    console.log('   2. Or: await window.getLLMConfig()');
    console.log('   3. Or: window.getLLMConfig()');
    console.log('');
    console.log('   Example:');
    console.log('   await configureLLMExtraction({ enabled: true, provider: "transformers" })');
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.log('');
    console.log('%c⚠️ If functions are not accessible, try:', 'color: #ffc107; font-weight: bold;');
    console.log('   1. Make sure you\'re in the SIDEBAR console (right-click sidebar → Inspect)');
    console.log('   2. Or use the PAGE console (F12 on main page)');
    console.log('   3. Try: window.getLLMConfig() or window.configureLLMExtraction()');
  }
})();

// Create a simple test function that can be called from console
(window as any).testLLMConfig = async () => {
  console.log('🧪 Testing LLM config functions...');
  try {
    const config = await (window as any).getLLMConfig();
    console.log('✅ getLLMConfig works! Config:', config);
    return config;
  } catch (error) {
    console.error('❌ getLLMConfig failed:', error);
    throw error;
  }
};

// Diagnostic helper to check what's available
(window as any).checkLLMFunctions = () => {
  console.log('🔍 Checking LLM function availability...');
  console.log('Window type:', typeof window);
  console.log('configureLLMExtraction:', typeof (window as any).configureLLMExtraction);
  console.log('getLLMConfig:', typeof (window as any).getLLMConfig);
  console.log('testLLMConfig:', typeof (window as any).testLLMConfig);
  console.log('');
  console.log('Try these commands:');
  console.log('  - window.getLLMConfig()');
  console.log('  - window.configureLLMExtraction({ enabled: true })');
  console.log('  - window.testLLMConfig()');
  console.log('  - window.checkLLMFunctions()');
  return {
    configureLLMExtraction: typeof (window as any).configureLLMExtraction,
    getLLMConfig: typeof (window as any).getLLMConfig,
    testLLMConfig: typeof (window as any).testLLMConfig
  };
};

// Message interface
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: any[];
  citations?: {
    citations: Array<{
      start: number;
      end: number;
      sourceIndices: number[];
      confidence: number;
    }>;
  };
}

// Get elements
const queryInput = document.getElementById('query-input') as HTMLInputElement;
const searchButton = document.getElementById('search-button') as HTMLButtonElement;
const messagesContainer = document.getElementById('messages-container') as HTMLDivElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const statusSpinner = document.getElementById('status-spinner') as HTMLSpanElement;
const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;
// Settings button will be queried inside DOMContentLoaded to ensure it exists
let settingsBtn: HTMLButtonElement | null = null;
const settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
const settingsClose = document.getElementById('settings-close') as HTMLButtonElement;
const settingsCancel = document.getElementById('settings-cancel') as HTMLButtonElement;
const settingsForm = document.getElementById('settings-form') as HTMLFormElement;
// Mode selector
const modeSelect = document.getElementById('mode-select') as HTMLSelectElement;
const offlineModeConfig = document.getElementById('offline-mode-config') as HTMLDivElement;
const onlineModeConfig = document.getElementById('online-mode-config') as HTMLDivElement;

// Offline mode elements
const offlineProviderSelect = document.getElementById('offline-provider') as HTMLSelectElement;
const offlineOllamaConfig = document.getElementById('offline-ollama-config') as HTMLDivElement;
const offlineOllamaUrlInput = document.getElementById('offline-ollama-url') as HTMLInputElement;
const offlineModelSelect = document.getElementById('offline-model') as HTMLSelectElement;
const offlineModelStatus = document.getElementById('offline-model-status') as HTMLElement;
const offlineTimeoutInput = document.getElementById('offline-timeout') as HTMLInputElement;

// Online mode elements
const onlineProviderSelect = document.getElementById('online-provider') as HTMLSelectElement;
const onlineProviderConfigGroup = document.getElementById('online-provider-config-group') as HTMLDivElement;
const onlineApiUrlGroup = document.getElementById('online-api-url-group') as HTMLDivElement;
const onlineApiUrlInput = document.getElementById('online-api-url') as HTMLInputElement;
const onlineApiUrlHelp = document.getElementById('online-api-url-help') as HTMLElement;
const providerTokenGroup = document.getElementById('provider-token-group') as HTMLDivElement;
const providerTokenInput = document.getElementById('provider-token') as HTMLInputElement;
const providerTokenLabel = document.getElementById('provider-token-label') as HTMLLabelElement;
const providerTokenHelp = document.getElementById('provider-token-help') as HTMLElement;
const onlineModelSelect = document.getElementById('online-model') as HTMLSelectElement;
const onlineModelStatus = document.getElementById('online-model-status') as HTMLElement;
const onlineTimeoutInput = document.getElementById('online-timeout') as HTMLInputElement;

// Web search config (online mode)
const webSearchConfig = document.getElementById('web-search-config') as HTMLDivElement;
const maxToolStepsInput = document.getElementById('max-tool-steps') as HTMLInputElement;
const webSearchProviderSelect = document.getElementById('web-search-provider') as HTMLSelectElement;
const webSearchApiKeyInput = document.getElementById('web-search-api-key') as HTMLInputElement;

// Legacy elements (kept for backward compatibility, hidden)
const providerSelect = document.getElementById('provider') as HTMLSelectElement;
const providerConfigGroup = document.getElementById('provider-config-group') as HTMLDivElement;
const apiUrlGroup = document.getElementById('api-url-group') as HTMLDivElement;
const apiUrlInput = document.getElementById('api-url') as HTMLInputElement;
const apiUrlLabel = document.querySelector('label[for="api-url"]') as HTMLLabelElement;
const apiUrlHelp = document.getElementById('api-url-help') as HTMLElement;
const apiKeyGroup = document.getElementById('api-key-group') as HTMLDivElement;
const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const apiKeyHelp = document.getElementById('api-key-help') as HTMLElement;
const modelSelect = document.getElementById('model') as HTMLSelectElement;
const modelStatus = document.getElementById('model-status') as HTMLElement;
const timeoutInput = document.getElementById('timeout') as HTMLInputElement;
const settingsExportBtn = document.getElementById('settings-export') as HTMLButtonElement;
const settingsImportBtn = document.getElementById('settings-import') as HTMLButtonElement;
const settingsImportFile = document.getElementById('settings-import-file') as HTMLInputElement;

// State
let currentTabId: number | null = null;
let conversationHistory: Message[] = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab ID
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      currentTabId = tabs[0].id;
      updateStatus();
      // Update status every 3 seconds
      setInterval(updateStatus, 3000);
    }
  });

  // Close button
  closeBtn.addEventListener('click', () => {
    // Send message to content script to hide sidebar
    if (currentTabId) {
      chrome.tabs.sendMessage(currentTabId, { type: 'HIDE_SIDEBAR' });
    }
  });

  // Settings button - query inside DOMContentLoaded to ensure it exists
  settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  if (settingsBtn) {
    // Ensure button is enabled and visible
    settingsBtn.disabled = false;
    settingsBtn.style.opacity = '1';
    settingsBtn.style.cursor = 'pointer';
    settingsBtn.style.pointerEvents = 'auto';
    settingsBtn.style.zIndex = '1000';
    settingsBtn.setAttribute('tabindex', '0');
    
    // Make the entire button area clickable by wrapping click handler
    const handleClick = (e: MouseEvent | KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Settings] Settings button clicked');
      openSettings();
    };
    
    // Add click event listener to the button
    settingsBtn.addEventListener('click', handleClick);
    
    // Also handle mousedown to catch all clicks
    settingsBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    
    // Add keyboard support
    settingsBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        handleClick(e);
      }
    });
    
    // Make parent container also clickable as fallback
    const headerActions = settingsBtn.closest('.header-actions');
    if (headerActions) {
      headerActions.addEventListener('click', (e) => {
        if (e.target === settingsBtn || (e.target as HTMLElement).closest('#settings-btn')) {
          handleClick(e as MouseEvent);
        }
      });
    }
    
    console.log('[Settings] Settings button event listener attached', {
      disabled: settingsBtn.disabled,
      opacity: settingsBtn.style.opacity,
      cursor: settingsBtn.style.cursor,
      pointerEvents: settingsBtn.style.pointerEvents
    });
  } else {
    console.error('[Settings] Settings button not found in DOM');
    // Try again after a short delay
    setTimeout(() => {
      const retryBtn = document.getElementById('settings-btn') as HTMLButtonElement;
      if (retryBtn) {
        console.log('[Settings] Found button on retry');
        settingsBtn = retryBtn;
        settingsBtn.disabled = false;
        settingsBtn.style.opacity = '1';
        settingsBtn.style.cursor = 'pointer';
        settingsBtn.addEventListener('click', () => openSettings());
      }
    }, 100);
  }

  // Settings modal close buttons
  if (settingsClose) {
    settingsClose.addEventListener('click', () => {
      closeSettings();
    });
  }

  if (settingsCancel) {
    settingsCancel.addEventListener('click', () => {
      closeSettings();
    });
  }

  // Close modal on outside click
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        closeSettings();
      }
    });
  }

  // Provider selection handler
  // Mode selector
  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      updateModeVisibility();
      updateTransformersInfoBanner();
    });
  }
  
  // Offline provider selector
  if (offlineProviderSelect) {
    offlineProviderSelect.addEventListener('change', () => {
      updateOfflineProviderConfig();
    });
  }
  
  // Online provider selector
  if (onlineProviderSelect) {
    onlineProviderSelect.addEventListener('change', () => {
      updateOnlineProviderConfig();
    });
  }
  
  // Legacy provider selector (kept for backward compatibility, but hidden)
  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      updateProviderConfigVisibility();
      updateTransformersInfoBanner();
    });
  }
  
  // Initial visibility update
  updateModeVisibility();
  
  // Re-fetch models when offline Ollama URL changes
  if (offlineOllamaUrlInput) {
    offlineOllamaUrlInput.addEventListener('blur', () => {
      if (offlineProviderSelect?.value === 'ollama') {
        fetchModelsForProvider('ollama', offlineOllamaUrlInput.value, undefined, offlineModelSelect, offlineModelStatus);
      }
    });
  }
  
  // Re-fetch models when online API URL or token changes
  if (onlineApiUrlInput) {
    onlineApiUrlInput.addEventListener('blur', () => {
      if (onlineProviderSelect?.value && modeSelect?.value === 'online') {
        const provider = onlineProviderSelect.value;
        const apiKey = providerTokenInput?.value;
        fetchModelsForProvider(provider, onlineApiUrlInput.value, apiKey, onlineModelSelect, onlineModelStatus);
      }
    });
  }
  
  if (providerTokenInput) {
    providerTokenInput.addEventListener('blur', () => {
      if (onlineProviderSelect?.value && modeSelect?.value === 'online') {
        const provider = onlineProviderSelect.value;
        const apiUrl = onlineApiUrlInput?.value;
        fetchModelsForProvider(provider, apiUrl, providerTokenInput.value, onlineModelSelect, onlineModelStatus);
      }
    });
  }
  
  // Legacy: Re-fetch models when API URL or API key changes (kept for backward compatibility)
  if (apiUrlInput) {
    apiUrlInput.addEventListener('blur', () => {
      if (providerSelect?.value !== 'transformers') {
        fetchProviderModels();
      }
    });
  }
  
  if (apiKeyInput) {
    apiKeyInput.addEventListener('blur', () => {
      if (providerSelect?.value === 'openai' || providerSelect?.value === 'custom') {
        fetchProviderModels();
      }
    });
  }

  // Settings form submit
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveSettings();
    });
  }

  // Export settings
  if (settingsExportBtn) {
    settingsExportBtn.addEventListener('click', async () => {
      try {
        const { getPersistentStorage } = await import('../../utils/persistentStorage');
        const storage = getPersistentStorage();
        const config = await getLLMConfigFn();
        
        if (!config) {
          alert('No settings to export. Please configure your settings first.');
          return;
        }

        await storage.savePreferences({ llmConfig: config });
        await storage.downloadPreferences(`pagewise-settings-${new Date().toISOString().split('T')[0]}.json`);
        
        // Show success message
        const originalText = settingsExportBtn.textContent;
        settingsExportBtn.textContent = '✓ Exported!';
        settingsExportBtn.style.background = '#4caf50';
        setTimeout(() => {
          settingsExportBtn.textContent = originalText;
          settingsExportBtn.style.background = '';
        }, 2000);
      } catch (error) {
        console.error('Failed to export settings:', error);
        alert('Failed to export settings. Check console for details.');
      }
    });
  }

  // Import settings
  if (settingsImportBtn && settingsImportFile) {
    settingsImportBtn.addEventListener('click', () => {
      settingsImportFile.click();
    });

    settingsImportFile.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const { getPersistentStorage } = await import('../../utils/persistentStorage');
        const storage = getPersistentStorage();
        
        await storage.importPreferences(text);
        
        // Reload settings to show imported config
        await loadSettings();
        
        // Show success message
        const originalText = settingsImportBtn.textContent;
        settingsImportBtn.textContent = '✓ Imported!';
        settingsImportBtn.style.background = '#4caf50';
        setTimeout(() => {
          settingsImportBtn.textContent = originalText;
          settingsImportBtn.style.background = '';
        }, 2000);
        
        // Clear file input
        settingsImportFile.value = '';
      } catch (error) {
        console.error('Failed to import settings:', error);
        alert(`Failed to import settings: ${error instanceof Error ? error.message : String(error)}`);
        settingsImportFile.value = '';
      }
    });
  }

  // Load current settings first (needed for first-time check)
  await loadSettings();
  
  // Check if it's first time use BEFORE focusing input or initializing conversation
  // This must happen early to prevent focus on search input
  const isFirstTime = await checkFirstTimeAndOpenSettings();
  
  // Show/hide Transformers.js info banner
  updateTransformersInfoBanner();
  
  // Dismiss info banner button
  const dismissInfoBanner = document.getElementById('dismiss-info-banner');
  const transformersInfoBanner = document.getElementById('transformers-info-banner');
  if (dismissInfoBanner && transformersInfoBanner) {
    dismissInfoBanner.addEventListener('click', () => {
      transformersInfoBanner.style.display = 'none';
      // Remember dismissal in localStorage
      localStorage.setItem('transformers-info-banner-dismissed', 'true');
    });
  }

  // Search button
  searchButton.addEventListener('click', handleSearch);

  // Enter key to send message
  queryInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  });

  // Only focus input if NOT first time use
  // If first time, settings modal is already open and should prevent interaction
  if (!isFirstTime) {
    queryInput.focus();
  } else {
    // If first time, ensure settings modal is visible and prevent focus on search
    // Settings should already be open from checkFirstTimeAndOpenSettings
    if (settingsModal) {
      settingsModal.classList.add('show');
      // Blur any focused elements to ensure settings modal is the focus
      if (document.activeElement) {
        (document.activeElement as HTMLElement).blur();
      }
    }
  }
  
  // Initialize conversation display
  renderConversation();
  
  // Listen for streaming messages from content script via window.postMessage
  // (since sidebar is in an iframe)
  window.addEventListener('message', (event) => {
    // Only accept messages from our extension
    if (event.data && typeof event.data === 'object') {
      if (event.data.type === 'TOOL_CALL') {
        // Handle tool call notification
        const { tool, status } = event.data;
        showToolIndicator(tool, status);
      } else if (event.data.type === 'STREAMING_START') {
        // Reset streaming state
        currentStreamingMessage = null;
        // Keep typing indicator visible
        console.log('[Sidebar] Streaming started');
      } else if (event.data.type === 'STREAMING_CHUNK') {
        // Update streaming message
        updateStreamingMessage(event.data.chunk, event.data.accumulated);
      } else if (event.data.type === 'STREAMING_COMPLETE') {
        // Complete streaming - will be handled by the main response handler
        console.log('[Sidebar] Streaming completed');
      } else if (event.data.type === 'OPEN_SETTINGS_FIRST_TIME') {
        // Open settings automatically on first time use
        console.log('[Sidebar] First time use detected - opening settings');
        openSettings();
      }
    }
  });
});

// Check if content script is available
async function checkContentScript(tabId: number): Promise<boolean> {
  try {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  } catch (error) {
    return false;
  }
}

// Wait for content script to be available
// Note: Content script is auto-injected via manifest.json, so we just wait for it
async function ensureContentScript(tabId: number): Promise<void> {
  // Content script is auto-injected via manifest.json
  // We just need to wait a bit for it to initialize
  // No need to manually inject - that would cause errors
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// Update status
async function updateStatus() {
  if (!currentTabId) return;

  // Check if content script is loaded
  const isLoaded = await checkContentScript(currentTabId);
  
  if (!isLoaded) {
    setStatus('⏳ Waiting for content script to load...', 'loading');
    // Content script is auto-injected via manifest.json
    // Just wait a bit and retry - it might just need time to initialize
    await ensureContentScript(currentTabId);
    // Retry after a short delay
    setTimeout(() => {
      updateStatus();
    }, 1000);
    return;
  }

  // Content script is loaded, get status
  chrome.tabs.sendMessage(currentTabId, { type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(`⚠️ ${chrome.runtime.lastError.message}`, 'error');
      return;
    }
    
    if (response) {
      if (response.initialized) {
        setStatus(`✅ Ready - ${response.chunkCount} chunks indexed`, 'ready');
        searchButton.disabled = false;
      } else if (response.isInitializing) {
        setStatus('⏳ Initializing (this may take a minute for first load)...', 'loading');
        searchButton.disabled = true;
      } else {
        // Not initialized yet - this is OK, user needs to configure settings first
        setStatus('⚙️ Configure settings to get started', 'ready');
        searchButton.disabled = false; // Allow search, it will initialize on demand
      }
    } else {
      setStatus('⚠️ No response from content script', 'error');
      searchButton.disabled = true;
    }
  });
}

// Set status message
function setStatus(message: string, type: 'ready' | 'loading' | 'error') {
  if (statusText) {
    statusText.textContent = message;
  } else {
    statusDiv.textContent = message;
  }
  statusDiv.className = `status ${type}`;
  
  // Show/hide spinner based on status type
  if (statusSpinner) {
    if (type === 'loading') {
      statusSpinner.style.display = 'inline-block';
    } else {
      statusSpinner.style.display = 'none';
    }
  }
}

// Summarize conversation history when it exceeds 10 messages
async function summarizeConversationHistory(): Promise<void> {
  // We want to keep: [summary] + [last 10 messages]
  // So if we have more than 11 messages (1 summary + 10 recent + new ones), we need to summarize
  if (conversationHistory.length <= 10) {
    return; // No need to summarize
  }

  // Check if the first message is already a summary
  const firstMessage = conversationHistory[0];
  const isFirstMessageSummary = firstMessage?.content?.startsWith('[Conversation Summary]');

  // Get messages to summarize
  // If we already have a summary, we want to summarize: [old summary] + [messages between summary and last 10]
  // If we don't have a summary, we want to summarize: [all messages except last 10]
  const last10Messages = conversationHistory.slice(-10);
  const messagesToSummarize = isFirstMessageSummary
    ? conversationHistory.slice(0, -10) // Include the old summary in the new summary
    : conversationHistory.slice(0, -10);

  if (messagesToSummarize.length === 0) {
    return; // Nothing to summarize
  }

  try {
    // Import LocalModelService dynamically
    const { LocalModelService } = await import('../../core/LocalModelService');
    
    // Get LLM config to initialize the service
    const config = await getLLMConfigFn();
    const llmService = LocalModelService.getInstance(config || {});
    
    // Create a prompt to summarize the conversation
    // If the first message is already a summary, we'll include it in the new summary
    const conversationText = messagesToSummarize
      .map(msg => {
        // If it's already a summary, extract just the summary part
        const content = msg.content.startsWith('[Conversation Summary]')
          ? msg.content.replace('[Conversation Summary]', '').trim()
          : `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`;
        return content;
      })
      .join('\n\n');
    
    const summaryPrompt = `Please provide a concise summary of the following conversation. Focus on the main topics discussed, key questions asked, and important information shared. Keep it brief but comprehensive.

Conversation:
${conversationText}

Summary:`;

    // Generate summary
    const summary = await llmService.generate(summaryPrompt, {
      max_new_tokens: 300,
      temperature: 0.3,
      top_p: 0.9
    });
    
    // Create summary message
    const summaryMessage: Message = {
      role: 'assistant',
      content: `[Conversation Summary] ${summary.trim()}`,
      timestamp: new Date()
    };

    // Replace conversation history with: [summary] + [last 10 messages]
    conversationHistory = [summaryMessage, ...last10Messages];
    
    console.log('[Sidebar] Conversation summarized. History now contains summary + last 10 messages.');
  } catch (error) {
    console.error('[Sidebar] Failed to summarize conversation:', error);
    // On error, just keep the last 10 messages without summary
    conversationHistory = conversationHistory.slice(-10);
  }
}

// Handle search
async function handleSearch() {
  const query = queryInput.value.trim();
  if (!query || !currentTabId) return;

  // Clear input
  queryInput.value = '';

  // Summarize conversation history if it exceeds 10 messages (before adding new message)
  await summarizeConversationHistory();

  // Add user message to conversation
  addMessage('user', query);
  
  // After adding, if we have more than 11 messages (summary + 11 recent), summarize again
  // This ensures we always have at most: [summary] + [last 10 messages]
  if (conversationHistory.length > 11) {
    await summarizeConversationHistory();
  }
  
  renderConversation();

  // Immediate visual feedback
  searchButton.disabled = true;
  searchButton.textContent = 'Sending...';
  searchButton.classList.add('searching');

  // Show typing indicator
  showTypingIndicator();

  // Auto-expand sidebar when conversation starts
  if (window.parent) {
    window.parent.postMessage({ type: '__RAG_SIDEBAR_EXPAND__' }, '*');
  }

  // Ensure content script is loaded
  const isLoaded = await checkContentScript(currentTabId);
  if (!isLoaded) {
    await ensureContentScript(currentTabId);
    const retryLoaded = await checkContentScript(currentTabId);
    if (!retryLoaded) {
      hideTypingIndicator();
      addMessage('assistant', 'Error: Content script not available. Make sure you\'re on a web page (not chrome:// pages) and reload the page.');
      renderConversation();
      searchButton.disabled = false;
      searchButton.textContent = 'Send';
      searchButton.classList.remove('searching');
      return;
    }
  }
  
  // Don't show initialization message here - let the content script handle it
  // The ensureRAGInitialized function will check if already initialized and skip if so
  // Status will be updated automatically by updateStatus() after search completes
  
  // Prepare conversation history (summary + last 10 messages, or just last 10 if <= 10 total)
  const recentHistory = conversationHistory.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
  
  chrome.tabs.sendMessage(
    currentTabId,
    {
      type: 'SEARCH',
      query,
      conversationHistory: recentHistory,
      options: { limit: 10 }
    },
    async (response) => {
      // Hide typing indicator
      hideTypingIndicator();

      // Re-enable search button
      searchButton.disabled = false;
      searchButton.textContent = 'Send';
      searchButton.classList.remove('searching');

      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message;
        addMessage('assistant', `Error: ${errorMsg}`);
        renderConversation();
        console.error('Sidebar error:', chrome.runtime.lastError);
        return;
      }
      
      if (response?.success) {
        // Update status after successful search (RAG should be initialized now)
        setTimeout(() => {
          updateStatus();
        }, 500);
        
        // Complete streaming if it was active
        if (currentStreamingMessage) {
          const answer = response.answer || (response.results.length > 0 
            ? 'I found some relevant information, but couldn\'t generate a summary. Please check the sources below.' 
            : 'I couldn\'t find any relevant information on this page.');
          
          // Insert citations into answer if available
          let answerWithCitations = answer;
          if (response.citations && response.citations.citations.length > 0) {
            answerWithCitations = insertCitations(answer, response.citations);
          }
          
          completeStreamingMessage(answerWithCitations, response.results || [], response.citations);
        } else {
          // Non-streaming response
          const answer = response.answer || (response.results.length > 0 
            ? 'I found some relevant information, but couldn\'t generate a summary. Please check the sources below.' 
            : 'I couldn\'t find any relevant information on this page.');
          
          // Insert citations into answer if available
          let answerWithCitations = answer;
          if (response.citations && response.citations.citations.length > 0) {
            answerWithCitations = insertCitations(answer, response.citations);
          }
          
          addMessage('assistant', answerWithCitations, response.results || [], response.citations);
          renderConversation();
        }
      } else {
        const errorMsg = response?.error || 'Unknown error';
        addMessage('assistant', `Error: ${errorMsg}`);
        renderConversation();
        console.error('Search error:', errorMsg);
      }
    }
  );
}


// Streaming state
let currentStreamingMessage: { element: HTMLElement | null; content: string } | null = null;

// Conversation management functions
function addMessage(role: 'user' | 'assistant', content: string, sources?: any[], citations?: any): void {
  conversationHistory.push({
    role,
    content,
    timestamp: new Date(),
    sources,
    citations
  });
}

// Add or update streaming message
function updateStreamingMessage(chunk: string, accumulated: string): void {
  // Hide typing indicator if visible
  hideTypingIndicator();
  
  if (!currentStreamingMessage) {
    // Create new streaming message
    addMessage('assistant', accumulated);
    renderConversation();
    
    // Find the last assistant message element
    const messages = messagesContainer.querySelectorAll('.message-assistant');
    const lastMessage = messages[messages.length - 1] as HTMLElement;
    
    if (lastMessage) {
      const contentElement = lastMessage.querySelector('.message-content') as HTMLElement;
      if (contentElement) {
        currentStreamingMessage = {
          element: contentElement,
          content: accumulated
        };
      }
    }
  } else {
    // Update existing streaming message
    currentStreamingMessage.content = accumulated;
    if (currentStreamingMessage.element) {
      // Update the content with proper formatting
      const formattedContent = escapeHtml(accumulated).replace(/\n/g, '<br>');
      currentStreamingMessage.element.innerHTML = formattedContent;
      
      // Auto-scroll to bottom
      scrollToBottom();
    }
  }
}

// Show tool execution indicator
function showToolIndicator(toolName: string, status: string): void {
  const toolIcons: Record<string, string> = {
    'web_search': '🔍',
    'page_search': '📄',
    'calculate': '🔢'
  };
  
  const icon = toolIcons[toolName] || '🔧';
  const statusText: Record<string, string> = {
    'executing': 'Searching...',
    'completed': 'Completed',
    'failed': 'Failed'
  };
  
  const message = `${icon} ${statusText[status] || status}: ${toolName}`;
  
  // Add temporary tool indicator message
  if (status === 'executing') {
    addMessage('assistant', message);
    renderConversation();
  } else if (status === 'completed' || status === 'failed') {
    // Update the last message if it's a tool indicator
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage && lastMessage.content.includes(toolName)) {
      lastMessage.content = message;
      renderConversation();
    }
  }
}

// Complete streaming message
function completeStreamingMessage(finalAnswer: string, sources?: any[], citations?: any): void {
  if (currentStreamingMessage) {
    // Update the last message in history
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.content = finalAnswer;
      lastMessage.sources = sources;
      lastMessage.citations = citations;
    }
    
    // Re-render to apply citations and formatting
    renderConversation();
    currentStreamingMessage = null;
  }
}

function clearConversation(): void {
  conversationHistory = [];
  renderConversation();
}

// Insert citation markers into answer text
function insertCitations(answer: string, citationMap: any): string {
  if (!citationMap || !citationMap.citations || citationMap.citations.length === 0) {
    return answer;
  }
  
  // Sort citations by position (reverse order to preserve indices when inserting)
  const sortedCitations = [...citationMap.citations].sort((a, b) => b.end - a.end);
  
  let result = answer;
  
  // Insert citations from end to start to preserve positions
  sortedCitations.forEach(citation => {
    const sourceNumbers = citation.sourceIndices.map((idx: number) => idx + 1).join(',');
    const citationMarker = `[${sourceNumbers}]`;
    
    // Insert citation marker at the end of the segment
    const before = result.substring(0, citation.end);
    const after = result.substring(citation.end);
    result = before + citationMarker + after;
  });
  
  return result;
}

// Helper function to escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Scroll to bottom of messages
function scrollToBottom(): void {
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// Show typing indicator
function showTypingIndicator(): void {
  if (messagesContainer) {
    const typingHtml = `
      <div class="message message-assistant typing-message">
        <div class="message-content">
          <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    `;
    messagesContainer.insertAdjacentHTML('beforeend', typingHtml);
    scrollToBottom();
  }
}

// Hide typing indicator
function hideTypingIndicator(): void {
  if (messagesContainer) {
    const typingMessage = messagesContainer.querySelector('.typing-message');
    if (typingMessage) {
      typingMessage.remove();
    }
  }
}

// Render entire conversation
function renderConversation(): void {
  if (!messagesContainer) return;
  
  if (conversationHistory.length === 0) {
    messagesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💬</div>
        <p>Start a conversation by asking a question about this page</p>
      </div>
    `;
    return;
  }
  
  let html = '';
  conversationHistory.forEach((message, msgIndex) => {
    html += renderMessage(message, msgIndex);
  });
  
  messagesContainer.innerHTML = html;
  
  // Add click handlers for sources
  conversationHistory.forEach((message, msgIndex) => {
    if (message.sources && message.sources.length > 0) {
      message.sources.forEach((source, sourceIndex) => {
        const sourceElement = messagesContainer.querySelector(`.message-${msgIndex} .source-item[data-source-index="${sourceIndex}"]`);
        if (sourceElement) {
          sourceElement.addEventListener('click', () => {
            navigateToResult(source);
          });
        }
      });
    }
  });
  
  // Add click handlers for citations
  messagesContainer.querySelectorAll('.citation').forEach(citationEl => {
    citationEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const sourcesAttr = citationEl.getAttribute('data-sources');
      const messageIndex = citationEl.getAttribute('data-message-index');
      
      if (sourcesAttr && messageIndex) {
        const sourceIndices = sourcesAttr.split(',').map(s => parseInt(s.trim()));
        const message = conversationHistory[parseInt(messageIndex)];
        
        if (message && message.sources) {
          // Highlight clicked citation
          citationEl.classList.add('citation-clicked');
          
          // Scroll to and highlight first source
          if (sourceIndices.length > 0 && message.sources[sourceIndices[0]]) {
            const sourceElement = messagesContainer.querySelector(
              `.message-${messageIndex} .source-item[data-source-index="${sourceIndices[0]}"]`
            ) as HTMLElement;
            
            if (sourceElement) {
              // Remove previous highlights
              messagesContainer.querySelectorAll('.source-item.highlighted').forEach(el => {
                el.classList.remove('highlighted');
              });
              
              // Highlight this source
              sourceElement.classList.add('highlighted');
              
              // Scroll to source
              sourceElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              
              // Navigate to source on page
              navigateToResult(message.sources[sourceIndices[0]]);
            }
          }
        }
      }
    });
  });
  
  scrollToBottom();
}

// Render a single message
function renderMessage(message: Message, messageIndex: number): string {
  const timeStr = message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Parse and render citations in the content
  let contentHtml = escapeHtml(message.content);
  
  // Replace citation markers with clickable HTML
  // Pattern: [1], [2], [1,2], etc.
  contentHtml = contentHtml.replace(
    /\[(\d+(?:,\d+)*)\]/g,
    (match, sourceNumbers) => {
      const sources = sourceNumbers.split(',').map((n: string) => parseInt(n.trim()) - 1); // Convert to 0-based
      const sourceAttr = sources.join(',');
      return `<span class="citation" data-sources="${sourceAttr}" data-message-index="${messageIndex}">[${sourceNumbers}]</span>`;
    }
  );
  
  let html = `
    <div class="message message-${message.role} message-${messageIndex}">
      <div class="message-content">
        ${contentHtml}
      </div>
      <div class="message-time">${timeStr}</div>
  `;
  
  // Add sources for assistant messages
  if (message.role === 'assistant' && message.sources && message.sources.length > 0) {
    html += `
      <div class="message-sources">
        <details class="sources-details">
          <summary>Sources (${message.sources.length})</summary>
          <div class="sources-list">
            ${message.sources
              .map((result, i) => {
                const headingPath = result.chunk?.metadata?.headingPath || [];
                const pathText = headingPath.length > 0 
                  ? headingPath.join(' > ') 
                  : 'No heading';
                const text = result.chunk?.metadata?.raw_text || result.chunk?.text || '';
                const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;

                return `
                  <div class="source-item" data-source-index="${i}">
                    <div class="result-header">
                      <strong>Source ${i + 1}</strong>
                      <span class="result-score">${result.score?.toFixed(3) || '0.000'}</span>
                    </div>
                    <div class="result-path">${escapeHtml(pathText)}</div>
                    <div class="result-text">${escapeHtml(preview)}</div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </details>
      </div>
    `;
  }
  
  html += `</div>`;
  return html;
}

// Navigate to a search result
function navigateToResult(result: any) {
  if (!currentTabId) return;
  
  // Send message to content script to highlight and scroll to result
  chrome.tabs.sendMessage(currentTabId, {
    type: 'HIGHLIGHT_RESULT',
    chunkId: result.chunk.id
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Sidebar] Error navigating to result:', chrome.runtime.lastError);
    } else if (response?.success) {
      console.log('[Sidebar] ✅ Successfully navigated to result');
    } else {
      console.warn('[Sidebar] Navigation failed:', response?.error || 'Unknown error');
    }
  });
}

