/**
 * Chrome API Mock for Testing
 * 
 * This file mocks the Chrome Extension APIs to allow testing
 * the full extension flow in a standalone HTML page without
 * actually loading the extension.
 */

(function() {
  'use strict';

  // Message storage for inspection
  const messageHistory = [];
  const messageListeners = {
    runtime: [],
    tabs: []
  };

  // Mock chrome.runtime API
  const mockChrome = {
    runtime: {
      onMessage: {
        listeners: [],
        addListener: function(callback) {
          this.listeners.push(callback);
          messageListeners.runtime.push(callback);
        },
        removeListener: function(callback) {
          const index = this.listeners.indexOf(callback);
          if (index > -1) {
            this.listeners.splice(index, 1);
            messageListeners.runtime.splice(index, 1);
          }
        },
        hasListener: function(callback) {
          return this.listeners.indexOf(callback) > -1;
        }
      },
      sendMessage: function(message, callback) {
        const messageData = {
          type: 'runtime.sendMessage',
          message: message,
          timestamp: Date.now(),
          direction: 'outgoing'
        };
        messageHistory.push(messageData);
        
        // Trigger any registered listeners
        messageListeners.runtime.forEach(listener => {
          try {
            const response = listener(message, { id: 'mock-sender' }, function(response) {
              if (callback) callback(response);
            });
            // If listener returns true, it's async
            if (response === true && callback) {
              // Async response - callback will be called later
            } else if (response !== true && callback) {
              // Sync response
              callback(response);
            }
          } catch (e) {
            console.error('[Chrome Mock] Error in message listener:', e);
          }
        });
        
        // If no listeners, call callback with error
        if (messageListeners.runtime.length === 0 && callback) {
          callback({ success: false, error: 'No message listeners registered' });
        }
      },
      getURL: function(path) {
        // Return path relative to test directory
        return `./dist/${path}`;
      },
      lastError: null
    },
    tabs: {
      sendMessage: function(tabId, message, callback) {
        const messageData = {
          type: 'tabs.sendMessage',
          tabId: tabId,
          message: message,
          timestamp: Date.now(),
          direction: 'outgoing'
        };
        messageHistory.push(messageData);
        
        // Trigger content script message handlers
        if (window.contentScriptMessageHandler) {
          try {
            const response = window.contentScriptMessageHandler(
              message,
              { tab: { id: tabId } },
              function(response) {
                if (callback) {
                  if (chrome.runtime.lastError) {
                    callback(undefined);
                  } else {
                    callback(response);
                  }
                }
              }
            );
            
            // If handler returns true, it's async (response will come via callback)
            // Otherwise, it's sync
            if (response !== true && callback) {
              callback(response);
            }
          } catch (e) {
            console.error('[Chrome Mock] Error in tabs.sendMessage handler:', e);
            if (callback) {
              callback({ success: false, error: e.message });
            }
          }
        } else {
          // No handler registered
          if (callback) {
            chrome.runtime.lastError = { message: 'Content script not loaded' };
            callback(undefined);
          }
        }
      },
      query: function(queryInfo, callback) {
        // Mock tab query - return current tab
        if (callback) {
          callback([{ id: 1, url: window.location.href, title: document.title }]);
        }
      },
      getCurrent: function(callback) {
        if (callback) {
          callback({ id: 1, url: window.location.href, title: document.title });
        }
      }
    },
    storage: {
      local: {
        get: function(keys, callback) {
          const result = {};
          const keysArray = Array.isArray(keys) ? keys : (keys ? [keys] : Object.keys(localStorage));
          
          keysArray.forEach(key => {
            try {
              const value = localStorage.getItem(key);
              if (value !== null) {
                result[key] = JSON.parse(value);
              }
            } catch (e) {
              // Ignore parse errors
            }
          });
          
          if (callback) {
            callback(result);
          }
          return Promise.resolve(result);
        },
        set: function(items, callback) {
          Object.keys(items).forEach(key => {
            try {
              localStorage.setItem(key, JSON.stringify(items[key]));
            } catch (e) {
              console.error('[Chrome Mock] Failed to save to localStorage:', e);
            }
          });
          
          if (callback) {
            callback();
          }
          return Promise.resolve();
        },
        remove: function(keys, callback) {
          const keysArray = Array.isArray(keys) ? keys : [keys];
          keysArray.forEach(key => {
            localStorage.removeItem(key);
          });
          
          if (callback) {
            callback();
          }
          return Promise.resolve();
        },
        clear: function(callback) {
          localStorage.clear();
          if (callback) {
            callback();
          }
          return Promise.resolve();
        }
      }
    },
    scripting: {
      executeScript: function(details, callback) {
        // Mock script execution - just call callback
        if (callback) {
          callback([{ result: 'mock-execution' }]);
        }
        return Promise.resolve([{ result: 'mock-execution' }]);
      }
    }
  };

  // Install mock if chrome is not available
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    window.chrome = mockChrome;
    console.log('[Chrome Mock] Chrome APIs mocked for testing');
  } else {
    // Chrome is available (running in extension), but add mock utilities
    window.chromeMock = mockChrome;
    console.log('[Chrome Mock] Chrome APIs available, mock utilities added as chromeMock');
  }

  // Expose message history and utilities
  window.chromeMessageHistory = messageHistory;
  window.chromeMessageListeners = messageListeners;

  // Utility functions for debugging
  window.debugChromeMessages = function() {
    console.table(messageHistory);
    return messageHistory;
  };

  window.clearChromeMessageHistory = function() {
    messageHistory.length = 0;
    console.log('[Chrome Mock] Message history cleared');
  };

  window.getChromeMessageListeners = function() {
    return {
      runtime: messageListeners.runtime.length,
      tabs: messageListeners.tabs.length
    };
  };

  // Helper to manually trigger a message (for testing)
  window.triggerChromeMessage = function(message, sender, callback) {
    messageListeners.runtime.forEach(listener => {
      try {
        listener(message, sender || { id: 'mock-sender' }, callback || function() {});
      } catch (e) {
        console.error('[Chrome Mock] Error triggering message:', e);
      }
    });
  };

})();
