/**
 * Background Service Worker
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Comet-like RAG extension installed');
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
  
  // Proxy Ollama API requests to avoid CORS issues
  if (message.type === 'OLLAMA_REQUEST') {
    const { url, body, timeout } = message;
    
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
});

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

