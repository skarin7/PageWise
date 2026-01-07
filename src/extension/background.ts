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

