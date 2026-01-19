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
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;

// State
let currentTabId: number | null = null;
let conversationHistory: Message[] = [];

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

  // Clear conversation button
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearConversation();
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

  // Focus input on load
  queryInput.focus();
  
  // Initialize conversation display
  renderConversation();
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

  // Clear input
  queryInput.value = '';

  // Add user message to conversation
  addMessage('user', query);
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
  
  // Prepare conversation history (last 10 messages for context)
  const recentHistory = conversationHistory.slice(-10).map(msg => ({
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
        // Add assistant message with answer and sources
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
      } else {
        const errorMsg = response?.error || 'Unknown error';
        addMessage('assistant', `Error: ${errorMsg}`);
        renderConversation();
        console.error('Search error:', errorMsg);
      }
    }
  );
}


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

