/**
 * Popup UI for query interface
 */

document.addEventListener('DOMContentLoaded', () => {
  const queryInput = document.getElementById('query-input') as HTMLInputElement;
  const searchButton = document.getElementById('search-button') as HTMLButtonElement;
  const resultsDiv = document.getElementById('results') as HTMLDivElement;
  const statusDiv = document.getElementById('status') as HTMLDivElement;
  const sidebarToggle = document.getElementById('sidebar-toggle') as HTMLButtonElement;

  // Check if content script is available
  async function checkContentScript(tabId: number): Promise<boolean> {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return true;
    } catch (error) {
      return false;
    }
  }

  // Inject content script if not already loaded
  async function ensureContentScript(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-script.js']
      });
      // Wait a bit for script to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Failed to inject content script:', error);
    }
  }

  // Auto-open sidebar on popup load
  async function autoOpenSidebar() {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) return;
      
      const tabId = tabs[0].id;
      
      // Ensure content script is loaded
      const isLoaded = await checkContentScript(tabId);
      if (!isLoaded) {
        try {
          await ensureContentScript(tabId);
        } catch (error) {
          console.error('Failed to inject content script:', error);
          return;
        }
      }
      
      // Show sidebar
      chrome.tabs.sendMessage(tabId, { type: 'SHOW_SIDEBAR' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error showing sidebar:', chrome.runtime.lastError);
        } else {
          // Close popup after opening sidebar
          setTimeout(() => {
            window.close();
          }, 100);
        }
      });
    });
  }

  // Auto-open sidebar immediately
  autoOpenSidebar();

  // Check status periodically
  async function updateStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) {
        statusDiv.textContent = '⚠️ No active tab found';
        statusDiv.style.color = 'orange';
        return;
      }

      const tabId = tabs[0].id;
      
      // Check if content script is loaded
      const isLoaded = await checkContentScript(tabId);
      
      if (!isLoaded) {
        statusDiv.textContent = '⏳ Loading content script...';
        statusDiv.style.color = 'orange';
        
        // Try to inject content script
        try {
          await ensureContentScript(tabId);
          // Wait a moment and try again
          setTimeout(updateStatus, 1000);
        } catch (error) {
          statusDiv.textContent = '❌ Cannot inject content script. Make sure you\'re on a web page (not chrome:// pages)';
          statusDiv.style.color = 'red';
        }
        return;
      }

      // Content script is loaded, get status
      chrome.tabs.sendMessage(tabId, { type: 'GET_STATUS' }, (response) => {
        if (chrome.runtime.lastError) {
          statusDiv.textContent = `⚠️ ${chrome.runtime.lastError.message}`;
          statusDiv.style.color = 'orange';
          return;
        }
        
        if (response) {
          if (response.initialized) {
            statusDiv.textContent = `✅ Ready - ${response.chunkCount} chunks indexed`;
            statusDiv.style.color = 'green';
          } else if (response.isInitializing) {
            statusDiv.textContent = '⏳ Initializing (this may take a minute for first load)...';
            statusDiv.style.color = 'orange';
            // Check again in 2 seconds
            setTimeout(updateStatus, 2000);
          } else {
            statusDiv.textContent = '⚠️ Not initialized - check console for errors';
            statusDiv.style.color = 'red';
          }
        } else {
          statusDiv.textContent = '⚠️ No response from content script';
          statusDiv.style.color = 'orange';
        }
      });
    });
  }
  
  updateStatus();
  // Update status every 3 seconds while popup is open
  const statusInterval = setInterval(updateStatus, 3000);
  
  // Sidebar toggle
  sidebarToggle.addEventListener('click', async () => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) return;
      
      const tabId = tabs[0].id;
      
      // Ensure content script is loaded
      const isLoaded = await checkContentScript(tabId);
      if (!isLoaded) {
        try {
          await ensureContentScript(tabId);
        } catch (error) {
          console.error('Failed to inject content script:', error);
          return;
        }
      }
      
      // Show sidebar
      chrome.tabs.sendMessage(tabId, { type: 'SHOW_SIDEBAR' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error showing sidebar:', chrome.runtime.lastError);
        } else {
          // Close popup after opening sidebar
          setTimeout(() => {
            window.close();
          }, 100); // Small delay to ensure message is sent
        }
      });
    });
  });

  // Search handler
  searchButton.addEventListener('click', async () => {
    const query = queryInput.value.trim();
    if (!query) return;

    resultsDiv.innerHTML = '<p>Searching...</p>';

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) {
        resultsDiv.innerHTML = '<p style="color: red;">Error: No active tab found</p>';
        return;
      }

      const tabId = tabs[0].id;
      
      // Ensure content script is loaded
      const isLoaded = await checkContentScript(tabId);
      if (!isLoaded) {
        try {
          await ensureContentScript(tabId);
        } catch (error) {
          resultsDiv.innerHTML = '<p style="color: red;">Error: Cannot inject content script. Make sure you\'re on a web page.</p>';
          return;
        }
      }
      
      chrome.tabs.sendMessage(
        tabId,
        {
          type: 'SEARCH',
          query,
          options: { limit: 5 }
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resultsDiv.innerHTML = `<p style="color: red;">Error: ${chrome.runtime.lastError.message}</p>`;
            console.error('Popup error:', chrome.runtime.lastError);
            return;
          }
          
          if (response?.success) {
            displayResults(response.results);
          } else {
            const errorMsg = response?.error || 'Unknown error';
            resultsDiv.innerHTML = `<p style="color: red;">Error: ${errorMsg}</p>`;
            console.error('Search error:', errorMsg);
          }
        }
      );
    });
  });

  // Enter key to search
  queryInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchButton.click();
    }
  });

  function displayResults(results: any[]) {
    if (results.length === 0) {
      resultsDiv.innerHTML = '<p>No results found</p>';
      return;
    }

    resultsDiv.innerHTML = results
      .map(
        (result, i) => {
          const headingPath = result.chunk.metadata.headingPath || [];
          const pathText = headingPath.length > 0 ? headingPath.join(' > ') : 'No heading';
          const text = result.chunk.metadata.raw_text || result.chunk.text;
          const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
          
          return `
      <div class="result-item" data-index="${i}" style="margin: 10px 0; padding: 12px; border: 1px solid #ddd; border-radius: 5px; cursor: pointer; transition: all 0.2s; background: #f9f9f9;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <strong>Result ${i + 1}</strong>
          <span style="font-size: 11px; color: #666; background: #e0e0e0; padding: 2px 8px; border-radius: 12px;">${result.score.toFixed(3)}</span>
        </div>
        <small style="color: #667eea; font-weight: 500; display: block; margin-bottom: 6px;">${pathText}</small>
        <p style="font-size: 13px; color: #333; line-height: 1.5; margin: 0;">${preview}</p>
      </div>
    `;
        }
      )
      .join('');

    // Add click handlers to navigate to results
    resultsDiv.querySelectorAll('.result-item').forEach((item, i) => {
      item.addEventListener('click', () => {
        navigateToResult(results[i]);
      });
      
      // Add hover effect
      item.addEventListener('mouseenter', () => {
        (item as HTMLElement).style.background = '#f0f0f0';
        (item as HTMLElement).style.borderColor = '#667eea';
        (item as HTMLElement).style.transform = 'translateY(-2px)';
        (item as HTMLElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
      });
      
      item.addEventListener('mouseleave', () => {
        (item as HTMLElement).style.background = '#f9f9f9';
        (item as HTMLElement).style.borderColor = '#ddd';
        (item as HTMLElement).style.transform = 'translateY(0)';
        (item as HTMLElement).style.boxShadow = 'none';
      });
    });
  }

  // Navigate to a search result
  function navigateToResult(result: any) {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) return;
      
      const tabId = tabs[0].id;
      
      // Ensure content script is loaded
      const isLoaded = await checkContentScript(tabId);
      if (!isLoaded) {
        try {
          await ensureContentScript(tabId);
        } catch (error) {
          console.error('Failed to inject content script:', error);
          return;
        }
      }
      
      // Send message to highlight and scroll to result
      chrome.tabs.sendMessage(tabId, {
        type: 'HIGHLIGHT_RESULT',
        chunkId: result.chunk.id
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error navigating to result:', chrome.runtime.lastError);
        } else {
          // Close popup after navigating (optional)
          // window.close();
        }
      });
    });
  }
});

