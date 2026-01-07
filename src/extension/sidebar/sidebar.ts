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

// Log helper message immediately and verify functions are available
console.log('%c💡 LLM Config Helpers Available', 'color: #667eea; font-weight: bold; font-size: 14px;');
console.log('  - configureLLMExtraction(config) - Enable/configure LLM extraction');
console.log('  - getLLMConfig() - Get current LLM config');
console.log('');
console.log('Example: await configureLLMExtraction({ enabled: true, provider: "transformers" })');
console.log('');

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

// Get elements
const queryInput = document.getElementById('query-input') as HTMLInputElement;
const searchButton = document.getElementById('search-button') as HTMLButtonElement;
const resultsDiv = document.getElementById('results') as HTMLDivElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const statusSpinner = document.getElementById('status-spinner') as HTMLSpanElement;
const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;

// State
let currentTabId: number | null = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
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

  // Search button
  searchButton.addEventListener('click', handleSearch);

  // Enter key to search
  queryInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  });

  // Focus input on load
  queryInput.focus();
});

// Check if content script is available
async function checkContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
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
    setTimeout(updateStatus, 1000);
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
        setStatus('⚠️ Not initialized - check console for errors', 'error');
        searchButton.disabled = true;
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

// Handle search
async function handleSearch() {
  const query = queryInput.value.trim();
  if (!query || !currentTabId) return;

  // Immediate visual feedback
  searchButton.disabled = true;
  searchButton.textContent = 'Searching...';
  searchButton.classList.add('searching');

  // Fade out previous results if any
  const existingResults = resultsDiv.querySelectorAll('.result-item');
  if (existingResults.length > 0) {
    existingResults.forEach(item => {
      item.classList.add('fade-out');
    });
    // Wait for fade-out animation
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Show loading state with smooth appearance
  resultsDiv.innerHTML = `
    <div class="empty-state loading-container">
      <div class="loading-spinner" style="margin: 0 auto;"></div>
      <p style="margin-top: 16px;">Searching...</p>
    </div>
  `;

  // Ensure content script is loaded
  const isLoaded = await checkContentScript(currentTabId);
  if (!isLoaded) {
    // Content script is auto-injected via manifest.json
    // Just wait a bit and retry
    await ensureContentScript(currentTabId);
    // Retry the search after waiting
    const retryLoaded = await checkContentScript(currentTabId);
    if (!retryLoaded) {
      resultsDiv.innerHTML = '<div class="empty-state"><p style="color: #c62828;">Error: Content script not available. Make sure you\'re on a web page (not chrome:// pages) and reload the page.</p></div>';
      searchButton.disabled = false;
      searchButton.textContent = 'Search';
      searchButton.classList.remove('searching');
      return;
    }
  }
  
  chrome.tabs.sendMessage(
    currentTabId,
    {
      type: 'SEARCH',
      query,
      options: { limit: 10 }
    },
    async (response) => {
      // Re-enable search button
      searchButton.disabled = false;
      searchButton.textContent = 'Search';
      searchButton.classList.remove('searching');

      if (chrome.runtime.lastError) {
        // Fade out loading, show error
        const loadingContainer = resultsDiv.querySelector('.loading-container');
        if (loadingContainer) {
          loadingContainer.classList.add('fade-out');
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        resultsDiv.innerHTML = `<div class="empty-state"><p style="color: #c62828;">Error: ${chrome.runtime.lastError.message}</p></div>`;
        console.error('Sidebar error:', chrome.runtime.lastError);
        return;
      }
      
      if (response?.success) {
        // Fade out loading state smoothly
        const loadingContainer = resultsDiv.querySelector('.loading-container');
        if (loadingContainer) {
          loadingContainer.classList.add('fade-out');
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        // Display results with animation
        displayResults(response.results);
      } else {
        const errorMsg = response?.error || 'Unknown error';
        const loadingContainer = resultsDiv.querySelector('.loading-container');
        if (loadingContainer) {
          loadingContainer.classList.add('fade-out');
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        resultsDiv.innerHTML = `<div class="empty-state"><p style="color: #c62828;">Error: ${errorMsg}</p></div>`;
        console.error('Search error:', errorMsg);
      }
    }
  );
}

// Display search results with smooth animations
function displayResults(results: any[]) {
  if (results.length === 0) {
    resultsDiv.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <p>No results found. Try a different query.</p>
      </div>
    `;
    // Collapse sidebar when no results
    if (window.parent) {
      window.parent.postMessage({ type: '__RAG_SIDEBAR_COLLAPSE__' }, '*');
    }
    return;
  }

  // Auto-expand sidebar when results are shown
  if (window.parent) {
    window.parent.postMessage({ type: '__RAG_SIDEBAR_EXPAND__' }, '*');
  }

  // Use requestAnimationFrame for smooth rendering
  requestAnimationFrame(() => {
    resultsDiv.innerHTML = results
      .map((result, i) => {
        const headingPath = result.chunk.metadata.headingPath || [];
        const pathText = headingPath.length > 0 
          ? headingPath.join(' > ') 
          : 'No heading';
        const text = result.chunk.metadata.raw_text || result.chunk.text;
        const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;

        return `
          <div class="result-item" data-index="${i}">
            <div class="result-header">
              <strong>Result ${i + 1}</strong>
              <span class="result-score">${result.score.toFixed(3)}</span>
            </div>
            <div class="result-path">${pathText}</div>
            <div class="result-text">${preview}</div>
          </div>
        `;
      })
      .join('');

    // Add result count indicator (optional, can be shown in status)
    const resultCount = results.length;
    console.log(`[Sidebar] Displaying ${resultCount} results with animations`);

    // Add click handlers to scroll to results
    resultsDiv.querySelectorAll('.result-item').forEach((item, i) => {
      item.addEventListener('click', () => {
        navigateToResult(results[i]);
      });
    });
  });
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

