/**
 * Content Script - Runs on every page
 * 
 * Note: Using static imports instead of dynamic imports to avoid CSP issues
 * with chunk loading in browser extensions. This increases initial bundle size
 * but ensures compatibility with Content Security Policy.
 */

import { logger } from '../utils/logger';
import type { SearchResult } from '../types';
import { PageRAG } from '../core/PageRAG';
import { LocalModelService } from '../core/LocalModelService';
import { EmbeddingService } from '../core/EmbeddingService';
import { getLLMConfig, saveLLMConfig } from '../utils/llmContentExtraction';
import { AgentOrchestrator } from '../core/AgentOrchestrator';
import { toolRegistry } from '../core/AgentTools';
import { createWebSearchTool } from '../core/tools/webSearchTool';
import { createRAGPromptWithHistory, createRAGPromptWithoutHistory } from '../prompts';
import { getEnvironmentType, logEnvironmentInfo } from '../utils/environment';

// Inject highlight styles
const style = document.createElement('style');
style.textContent = `
  .rag-highlight {
    background-color: #ffff00 !important;
    transition: background-color 0.3s ease !important;
    border: 3px solid #ff6b00 !important;
    box-shadow: 0 0 15px rgba(255, 107, 0, 0.6) !important;
    outline: 2px solid rgba(255, 107, 0, 0.3) !important;
    outline-offset: 2px !important;
    animation: rag-pulse 2s ease-in-out infinite !important;
  }
  
  @keyframes rag-pulse {
    0%, 100% {
      box-shadow: 0 0 15px rgba(255, 107, 0, 0.6);
    }
    50% {
      box-shadow: 0 0 25px rgba(255, 107, 0, 0.8);
    }
  }
  
  /* Sidebar styles */
  #rag-sidebar-container {
    position: fixed;
    top: 50px;
    right: 15px;
    width: 400px;
    height: 350px; /* Default fixed height - more compact */
    max-height: 100vh; /* Don't exceed viewport */
    z-index: 2147483647;
    background: white;
    box-shadow: -2px 0 10px rgba(0,0,0,0.2);
    display: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    border-radius: 8px 0 0 8px;
    overflow: hidden;
    transition: height 0.3s ease-out;
  }
  
  #rag-sidebar-container.visible {
    display: block;
  }
  
  #rag-sidebar-container.expanded {
    height: calc(100vh - 60px);
  }
  
  /* Resize handles */
  #rag-sidebar-resize-handle {
    position: absolute;
    left: 0;
    top: 0;
    width: 4px;
    height: 100%;
    background: transparent;
    cursor: ew-resize;
    z-index: 10;
    transition: background 0.2s;
  }
  
  #rag-sidebar-resize-handle:hover {
    background: #667eea;
  }
  
  #rag-sidebar-resize-handle:active {
    background: #764ba2;
  }
  
  /* Height resize handle (top bar) - exclude close button area */
  #rag-sidebar-container .resize-height-handle {
    position: relative;
    top: 0;
    left: 0;
    right: 50px; /* Leave space for close button */
    height: 40px;
    z-index: 5;
    background: transparent;
    pointer-events: auto;
  }
  
  #rag-sidebar-container .resize-height-handle:hover {
    background: rgba(102, 126, 234, 0.1);
  }
  
  /* Corner resize handle (for diagonal resize) - smaller, doesn't overlap close button */
  #rag-sidebar-container .resize-corner-handle {
    position: absolute;
    top: 0;
    right: 50px; /* Leave space for close button */
    width: 20px;
    height: 20px;
    cursor: nwse-resize;
    z-index: 5;
    background: transparent;
    pointer-events: auto;
  }
  
  /* Ensure iframe and its content can receive pointer events */
  #rag-sidebar-iframe {
    pointer-events: auto;
    position: relative;
    z-index: 1;
  }
  
  /* Ensure close button in iframe is clickable */
  #rag-sidebar-iframe body .close-btn {
    position: relative;
    z-index: 20 !important;
    pointer-events: auto !important;
  }
  
  #rag-sidebar-iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }
`;
document.head.appendChild(style);

let rag: PageRAG | null = null; // PageRAG instance
let isInitializing = false;
let sidebarContainer: HTMLDivElement | null = null;

// Sidebar management - Define constants and functions before they're used
const SIDEBAR_STORAGE_KEY = 'rag_sidebar_open';

// Citation mapping interfaces and functions
interface Citation {
  start: number;
  end: number;
  sourceIndices: number[];
  confidence: number;
}

interface CitationMap {
  citations: Citation[];
}

interface AnswerSegment {
  text: string;
  start: number;
  end: number;
}

// Split answer into segments (sentences)
function splitAnswerIntoSegments(answer: string): AnswerSegment[] {
  if (!answer || answer.trim().length === 0) {
    return [];
  }
  
  // Split by sentence boundaries (., !, ?)
  const sentences = answer.split(/([.!?]+[\s\n]+)/).filter(s => s.trim());
  const segments: AnswerSegment[] = [];
  let currentPos = 0;
  
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i];
    // Guard against undefined sentence
    if (!sentence) {
      continue;
    }
    
    const punctuation = sentences[i + 1] || '';
    const fullSegment = sentence + punctuation;
    
    if (sentence.trim().length > 0) {
      segments.push({
        text: sentence.trim(),
        start: currentPos,
        end: currentPos + sentence.trim().length
      });
    }
    
    currentPos += fullSegment.length;
  }
  
  return segments;
}

// Calculate cosine similarity between two embeddings
function calculateCosineSimilarity(embedding1: number[], embedding2: number[]): number {
  if (embedding1.length !== embedding2.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }
  
  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}

// Extract key phrases from text (3-5 word n-grams)
function extractKeyPhrases(text: string, minWords: number = 3, maxWords: number = 5): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const phrases: string[] = [];
  
  for (let n = minWords; n <= maxWords; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      phrases.push(words.slice(i, i + n).join(' '));
    }
  }
  
  return phrases;
}

// Extract keywords from text (simple: nouns and important words)
function extractKeywords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3); // Filter short words
  
  // Remove common stop words
  const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use']);
  
  return words.filter(w => !stopWords.has(w));
}

// Find keyword matches between segment and sources
function findKeywordMatches(segment: string, sources: SearchResult[]): number[] {
  const segmentKeywords = new Set(extractKeywords(segment));
  const segmentPhrases = new Set(extractKeyPhrases(segment));
  const matchedSources: number[] = [];
  
  sources.forEach((source, index) => {
    const sourceText = source.chunk.metadata?.raw_text || source.chunk.text;
    const sourceKeywords = new Set(extractKeywords(sourceText));
    const sourcePhrases = new Set(extractKeyPhrases(sourceText));
    
    // Count keyword overlap
    let keywordOverlap = 0;
    segmentKeywords.forEach(kw => {
      if (sourceKeywords.has(kw)) keywordOverlap++;
    });
    
    // Check phrase matches
    let phraseMatches = 0;
    segmentPhrases.forEach(phrase => {
      if (sourcePhrases.has(phrase)) phraseMatches++;
    });
    
    // Match if significant overlap
    const keywordRatio = keywordOverlap / Math.max(segmentKeywords.size, 1);
    if (keywordRatio > 0.2 || phraseMatches > 0) {
      matchedSources.push(index);
    }
  });
  
  return matchedSources;
}

// Map answer segments to sources using embedding similarity and keyword matching
async function mapAnswerToSources(
  answer: string,
  sources: SearchResult[],
  embedder: EmbeddingService
): Promise<CitationMap> {
  if (!answer || sources.length === 0) {
    return { citations: [] };
  }
  
  const segments = splitAnswerIntoSegments(answer);
  if (segments.length === 0) {
    return { citations: [] };
  }
  
  // Use the provided embedder (should already be initialized)
  await embedder.init();
  
  // Generate embeddings for answer segments
  const segmentTexts = segments.map(s => s.text);
  const segmentEmbeddings = await embedder.embedBatch(segmentTexts);
  
  // Get source embeddings
  const sourceTexts = sources.map(s => s.chunk.metadata?.raw_text || s.chunk.text);
  const sourceEmbeddings = await embedder.embedBatch(sourceTexts);
  
  const citations: Citation[] = [];
  
  // For each segment, find matching sources
  segments.forEach((segment, segmentIndex) => {
    const segmentEmbedding = segmentEmbeddings[segmentIndex];
    if (!segmentEmbedding) return;
    
    // Calculate similarity with all sources
    const similarities: Array<{ index: number; similarity: number }> = [];
    
    sourceEmbeddings.forEach((sourceEmbedding: number[] | undefined, sourceIndex: number) => {
      if (sourceEmbedding) {
        const similarity = calculateCosineSimilarity(segmentEmbedding, sourceEmbedding);
        similarities.push({ index: sourceIndex, similarity });
      }
    });
    
    // Sort by similarity
    similarities.sort((a, b) => b.similarity - a.similarity);
    
    // Find top-k sources (k=1-3) with similarity > threshold
    const matchedSources: number[] = [];
    const HIGH_THRESHOLD = 0.75;
    const MEDIUM_THRESHOLD = 0.65;
    const LOW_THRESHOLD = 0.55;
    
    // Add high confidence matches
    similarities.forEach(({ index, similarity }) => {
      if (similarity > HIGH_THRESHOLD) {
        matchedSources.push(index);
      } else if (similarity > MEDIUM_THRESHOLD && matchedSources.length < 2) {
        matchedSources.push(index);
      } else if (similarity > LOW_THRESHOLD && matchedSources.length === 0) {
        // Only add if no other matches and check keyword match too
        const keywordMatches = findKeywordMatches(segment.text, [sources[index]]);
        if (keywordMatches.length > 0) {
          matchedSources.push(index);
        }
      }
    });
    
    // If no embedding matches, try keyword matching as fallback
    if (matchedSources.length === 0) {
      const keywordMatches = findKeywordMatches(segment.text, sources);
      matchedSources.push(...keywordMatches.slice(0, 2)); // Max 2 from keyword matching
    }
    
    // Create citation for this segment
    if (matchedSources.length > 0) {
      const topSimilarity = similarities.find(s => matchedSources.includes(s.index))?.similarity || 0.5;
      citations.push({
        start: segment.start,
        end: segment.end,
        sourceIndices: matchedSources,
        confidence: topSimilarity
      });
    }
  });
  
  // Sort citations by position
  citations.sort((a, b) => a.start - b.start);
  
  return { citations };
}

// Log environment info on load (only in development)
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  logEnvironmentInfo();
}

// Message listener - set up once, outside init function
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
 // logger.log('Content script received message:', message.type);
  
  // Debugger breakpoint: Message received
  if (typeof window !== 'undefined' && window.__DEBUG_MESSAGES__) {
    debugger;
  }
  
  // Log environment type in debug mode
  if (typeof window !== 'undefined' && window.__DEBUG_MESSAGES__) {
    logger.debug('[ContentScript] Environment:', getEnvironmentType());
  }
  
  // Handle ping for checking if content script is loaded
  if (message.type === 'PING') {
    try {
      sendResponse({ pong: true, initialized: rag?.isInitialized() || false });
    } catch (error) {
      // If sendResponse fails, try again
      try {
        sendResponse({ pong: true, initialized: false });
      } catch (e) {
        // Ignore - channel may be closed
      }
    }
    return false; // Synchronous response
  }
  
  if (message.type === 'SEARCH') {
    // Initialize RAG if not already initialized (lazy initialization)
    let responseSent = false;
    const safeSendResponse = (response: any) => {
      if (!responseSent) {
        responseSent = true;
        try {
          sendResponse(response);
        } catch (error) {
          console.warn('[ContentScript] Failed to send response (channel may be closed):', error);
        }
      }
    };
    
    ensureRAGInitialized().then(() => {
      // Continue with existing search logic
      handleSearch(message, sender, safeSendResponse);
    }).catch((error) => {
      console.error('[ContentScript] Failed to initialize RAG for search:', error);
      safeSendResponse({ 
        success: false, 
        error: 'Failed to initialize PageRAG. Please try again.' 
      });
    });
    return true; // Async response
  }
  
  if (message.type === 'GET_STATUS') {
    sendResponse({
      initialized: rag?.isInitialized() || false,
      chunkCount: rag?.getChunks().length || 0,
      isInitializing: isInitializing
    });
    return false; // Synchronous response
  }
  
  if (message.type === 'SHOW_SIDEBAR') {
    // Show sidebar immediately - don't initialize RAG yet
    // RAG will be initialized when user searches or after settings are saved
    showSidebar();
    sendResponse({ success: true });
    return false; // Synchronous response
  }
  
  if (message.type === 'HIDE_SIDEBAR') {
    hideSidebar();
    sendResponse({ success: true });
    return false;
  }
  
  if (message.type === 'TOGGLE_SIDEBAR') {
    // Toggle sidebar - don't initialize RAG yet
    // RAG will be initialized when user searches or after settings are saved
    toggleSidebar();
    sendResponse({ success: true });
    return false; // Synchronous response
  }
  
  if (message.type === 'HIGHLIGHT_RESULT') {
    if (rag && message.chunkId) {
      const chunks = rag.getChunks();
      const chunk = chunks.find((c: any) => c.id === message.chunkId);
      if (chunk) {
        highlightAndScrollToChunk(chunk);
        sendResponse({ success: true, found: true });
      } else {
        console.warn('[ContentScript] Chunk not found:', message.chunkId);
        sendResponse({ success: false, error: 'Chunk not found' });
      }
    } else {
      sendResponse({ success: false, error: 'RAG not initialized or chunkId missing' });
    }
    return false;
  }
  
  if (message.type === 'INITIALIZE_RAG_AFTER_SETTINGS') {
    // Initialize RAG after settings are saved (first time setup)
    // This triggers extraction and embedding generation
    ensureRAGInitialized().then(() => {
      logger.log('[ContentScript] RAG initialized after settings configuration');
      sendResponse({ success: true, initialized: true, chunkCount: rag?.getChunks().length || 0 });
    }).catch((error) => {
      console.error('[ContentScript] Failed to initialize RAG after settings:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Async response
  }
  
  if (message.type === 'INITIALIZE_RAG_NOW') {
    // Initialize RAG on demand (when user wants to search)
    ensureRAGInitialized().then(() => {
      logger.log('[ContentScript] RAG initialized on demand');
      sendResponse({ success: true, initialized: true, chunkCount: rag?.getChunks().length || 0 });
    }).catch((error) => {
      console.error('[ContentScript] Failed to initialize RAG:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Async response
  }
  
  return false;
});

// Handle search message (extracted for async initialization)
async function handleSearch(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): Promise<void> {
  // Debugger breakpoint: Entry to search handler
  if (typeof window !== 'undefined' && window.__DEBUG_SEARCH__) {
    debugger; // Set window.__DEBUG_SEARCH__ = true to enable breakpoint
  }
  
  // Track if response has been sent to prevent multiple calls
  let responseSent = false;
  const safeSendResponse = (response: any) => {
    if (!responseSent) {
      responseSent = true;
      try {
        sendResponse(response);
      } catch (error) {
        // Channel may have already closed, ignore error
        console.warn('[ContentScript] Failed to send response (channel may be closed):', error);
      }
    }
  };
  
  if (!rag || !rag.isInitialized()) {
    safeSendResponse({ 
      success: false, 
      error: 'PageRAG initialization failed. Please try again.' 
    });
    return;
  }
  
  // Get sender tab ID for streaming updates
  const senderTabId = sender.tab?.id;
  
  // Debugger breakpoint: Before RAG search
  logger.debug('[ContentScript] Starting RAG search for query:', message.query);
  if (typeof window !== 'undefined' && window.__DEBUG_RAG_SEARCH__) {
    debugger;
  }
  
  rag.search(message.query, message.options)
      .then(async (results: SearchResult[]) => {
        logger.log('[ContentScript] Search returned results:', results.length);
        
        // Debugger breakpoint: After RAG search
        if (typeof window !== 'undefined' && window.__DEBUG_RAG_RESULTS__) {
          debugger;
        }
        
        // Validate search results
        if (results.length === 0) {
          logger.warn('[ContentScript] No search results found for query:', message.query);
          safeSendResponse({ 
            success: true, 
            results: [],
            answer: 'I couldn\'t find any relevant information on this page to answer your question. Try rephrasing your query or asking about a different topic.',
            citations: { citations: [] }
          });
          return;
        }
        
        // Log search results details
        logger.log('[ContentScript] Top search results:');
        results.slice(0, 5).forEach((result: SearchResult, idx: number) => {
          const chunkText = result.chunk.metadata?.raw_text || result.chunk.text;
          const preview = chunkText.substring(0, 100) + (chunkText.length > 100 ? '...' : '');
          logger.log(`[ContentScript] Result ${idx + 1}: score=${result.score.toFixed(3)}, text="${preview}"`);
        });
        
        // Generate LLM answer from relevant chunks
        let answer: string | null = null;
        
        // Combine top chunks (up to 10) into context
        // Use more chunks if available to get better context
        const topChunks = results.slice(0, Math.min(15, results.length));
        
        // Validate chunks have content
        const validChunks = topChunks.filter((result: SearchResult) => {
          const chunkText = result.chunk.metadata?.raw_text || result.chunk.text;
          const hasContent = chunkText && chunkText.trim().length > 10; // At least 10 chars
          if (!hasContent) {
            logger.warn(`[ContentScript] Chunk ${result.chunk.id} is empty or too short: "${chunkText}"`);
          }
          return hasContent;
        });
        
        if (validChunks.length === 0) {
          logger.warn('[ContentScript] All chunks are empty or invalid');
          safeSendResponse({ 
            success: true, 
            results,
            answer: 'I found some results, but they don\'t contain readable content. The page might not be fully loaded yet.',
            citations: { citations: [] }
          });
          return;
        }
        
        logger.log(`[ContentScript] Using ${validChunks.length} valid chunks out of ${topChunks.length} results`);
        logger.log(`[ContentScript] Total chunks available: ${results.length}`);
        
        // Build context from valid chunks
        const context = validChunks
          .map((result: SearchResult, idx: number) => {
            const chunkText = result.chunk.metadata?.raw_text || result.chunk.text;
            // Log full chunk text (not just preview) to debug truncation issues
            logger.log(`[ContentScript] Chunk ${idx + 1} length: ${chunkText.length} chars`);
            logger.log(`[ContentScript] Chunk ${idx + 1} full text: "${chunkText}"`);
            logger.log(`[ContentScript] Chunk ${idx + 1} preview: "${chunkText.substring(0, 150)}..."`);
            return `[Source ${idx + 1}]\n${chunkText}`;
          })
          .join('\n\n');
        
        logger.log('[ContentScript] Context length:', context.length, 'characters');
        logger.log('[ContentScript] Context preview (first 500 chars):', context.substring(0, 500) + '...');
        logger.log('[ContentScript] Context full text (for debugging):', context);
        
        // Validate context is substantial
        if (context.length < 100) {
          logger.warn('[ContentScript] Context is too short:', context.length, 'chars');
          safeSendResponse({ 
            success: true, 
            results,
            answer: 'I found some information, but it\'s not enough to provide a comprehensive answer. Try asking a more specific question.',
            citations: { citations: [] }
          });
          return;
        }
        
        try {
          // Initialize and call LLM
          // Use the same LLM config that's used for content extraction
          const llmConfig = await getLLMConfig().catch(() => null);
          
          // Debugger breakpoint: Before LLM call
          if (typeof window !== 'undefined' && window.__DEBUG_LLM_CALL__) {
            debugger;
          }
          
          // Ensure llmConfig is available
          if (!llmConfig) {
            logger.error('[ContentScript] LLM config not available');
            safeSendResponse({ 
              success: false, 
              error: 'LLM configuration not available' 
            });
            return;
          }
          
          // Use the configured provider, or default to transformers
          // This ensures the same config is used for both extraction and search/RAG
          const provider = llmConfig.provider || 'transformers';
          
          // Determine agent mode: check mode field first, fallback to agentMode for backward compatibility
          const mode = llmConfig.mode || (llmConfig.agentMode ? 'online' : 'offline');
          const agentMode = mode === 'online' || (llmConfig.agentMode ?? false);
          const useAgentMode = agentMode && provider !== 'transformers';
          
          logger.log('[ContentScript] Using LLM config for search/RAG:', {
            mode: mode,
            provider,
            model: llmConfig.model,
            apiUrl: llmConfig.apiUrl,
            apiKey: llmConfig.apiKey ? '***' : undefined,
            timeout: llmConfig.timeout,
            agentMode: agentMode,
            webSearchProvider: llmConfig.webSearchProvider,
            hasWebSearchApiKey: !!llmConfig.webSearchApiKey
          });
          
          // Warn based on mode
          if (mode === 'offline') {
            logger.log('[ContentScript] Offline mode - agent mode and tool calling disabled');
          } else if (provider === 'transformers') {
            logger.warn('[ContentScript] ⚠️ Online mode selected but Transformers.js does not support tool calling.');
            logger.warn('[ContentScript] Use Ollama, OpenAI, OpenRouter, or Custom API for online mode with web search.');
          } else {
            logger.log('[ContentScript] Online mode - agent mode and tool calling enabled');
          }
          
          // Log why agent mode is or isn't being used
          logger.log('[ContentScript] Agent mode check:', {
            mode: mode,
            agentModeEnabled: agentMode,
            provider: provider,
            providerSupportsToolCalling: provider !== 'transformers',
            willUseAgentMode: useAgentMode,
            reason: mode === 'offline'
              ? 'Offline mode - agent mode disabled'
              : !agentMode
                ? 'Agent mode not enabled in config'
                : provider === 'transformers'
                  ? 'Transformers.js does not support tool calling'
                  : 'Online mode - agent mode enabled'
          });
          
          // For agent mode, we use AI SDK directly, so we don't need LocalModelService
          // For regular mode, we still use LocalModelService
          let llmService: any = null;
          
          if (!useAgentMode) {
            const llmServiceOptions: any = {
              provider: provider as any,
              modelName: llmConfig?.model,
              requestTimeoutMs: llmConfig?.timeout
            };
            
            // Set provider-specific options
            if (provider === 'ollama') {
              // For LocalModelService (regular mode), need full /api/generate path
              // Normalize user's URL to ensure we have the correct endpoint
              let ollamaUrl = llmConfig?.apiUrl || 'http://localhost:11434';
              
              // Remove any endpoint paths and construct /api/generate
              ollamaUrl = ollamaUrl
                .replace(/\/api\/generate$/, '')
                .replace(/\/api\/chat$/, '')
                .replace(/\/api\/tags$/, '')
                .replace(/\/api$/, '')
                .replace(/\/generate$/, '')
                .replace(/\/chat$/, '')
                .replace(/\/$/, '');
              
              // Construct full /api/generate path for LocalModelService
              llmServiceOptions.ollamaUrl = `${ollamaUrl}/api/generate`;
              
              logger.log('[ContentScript] LocalModelService Ollama URL:', {
                original: llmConfig?.apiUrl,
                normalized: llmServiceOptions.ollamaUrl
              });
            } else if (provider === 'openai' || provider === 'custom') {
              llmServiceOptions.apiUrl = llmConfig?.apiUrl;
              llmServiceOptions.apiKey = llmConfig?.apiKey;
            }
            
            llmService = LocalModelService.getInstance(llmServiceOptions);
            await llmService.init();
          }
          
          if (llmConfig?.agentMode && provider === 'transformers') {
            // Warn user that agent mode is not supported with Transformers.js
            logger.warn('[ContentScript] Agent mode requested but Transformers.js does not support tool calling. Falling back to regular mode.');
            console.warn('[PageRAG] ⚠️ Agent mode is not supported with Transformers.js. Only basic semantic search is available. Use Ollama, OpenAI, or Custom API for agent mode with tools.');
          }
          
          if (useAgentMode) {
            logger.log('[ContentScript] Agent mode enabled, using AgentOrchestrator');
            
            // Register web search tool if configured
            // For Ollama provider, prefer Ollama web search if no provider specified
            const webSearchProvider = (llmConfig.webSearchProvider || (provider === 'ollama' ? 'ollama' : 'ollama')) as any;
            
            if (webSearchProvider && llmConfig.webSearchApiKey) {
              const webSearchTool = createWebSearchTool({
                provider: webSearchProvider,
                apiKey: llmConfig.webSearchApiKey
              });
              toolRegistry.register(webSearchTool);
              logger.log('[ContentScript] ✅ Web search tool registered:', {
                provider: webSearchProvider,
                hasApiKey: !!llmConfig.webSearchApiKey,
                toolName: webSearchTool.name,
                toolDescription: webSearchTool.description.substring(0, 100),
                note: webSearchProvider === 'ollama' ? 'Using Ollama native web search API' : `Using ${webSearchProvider}`
              });
              logger.log('[ContentScript] All registered tools:', toolRegistry.getAll().map(t => ({
                name: t.name,
                description: t.description.substring(0, 80)
              })));
            } else {
              // Web search is optional but recommended for online mode
              const missingConfig = [];
              if (!webSearchProvider) missingConfig.push('webSearchProvider');
              if (!llmConfig.webSearchApiKey) missingConfig.push('webSearchApiKey');
              logger.warn('[ContentScript] ⚠️ Web search tool not configured. Missing:', missingConfig);
              logger.warn('[ContentScript] To enable web search in online mode, configure:');
              logger.warn('[ContentScript]   - Web Search Provider (e.g., "ollama", "tavily", "serper")');
              logger.warn('[ContentScript]   - Web Search API Key (get from provider)');
              logger.warn('[ContentScript] Agent will use only page content and training knowledge.');
            }
            
            // Create agent orchestrator with LLM config (uses AI SDK native tool calling)
            const orchestrator = new AgentOrchestrator(llmConfig, toolRegistry, {
              maxSteps: llmConfig.maxToolSteps || 3
            });
            
            // Convert conversation history format
            const conversationHistory = (message.conversationHistory || []).map((msg: any) => ({
              role: msg.role === 'user' ? 'user' : 'assistant',
              content: msg.content
            }));
            
            // Build page context from RAG results for agent
            const pageContext = validChunks
              .map((result: SearchResult, idx: number) => {
                const chunkText = result.chunk.metadata?.raw_text || result.chunk.text;
                return `[Page Content ${idx + 1}]\n${chunkText}`;
              })
              .join('\n\n');
            
            logger.log('[ContentScript] Page context prepared for agent, length:', pageContext.length, 'characters');
            
            // Pass page context to agent - it will be included in the query
            let agentQuery = message.query;
            if (pageContext && pageContext.length > 0) {
              // Include page context in the query so agent knows what's available on the page
              agentQuery = `Context from the current web page:\n\n${pageContext}\n\nUser question: ${message.query}\n\nIMPORTANT: First check if the answer is in the page context above. Only use web search if the information is NOT available in the page context.`;
            }
            
            // Send tool call notifications to sidebar
            const sidebarIframe = document.getElementById('rag-sidebar-iframe') as HTMLIFrameElement;
            const sendToolNotification = (toolName: string, status: string) => {
              if (sidebarIframe && sidebarIframe.contentWindow) {
                sidebarIframe.contentWindow.postMessage({
                  type: 'TOOL_CALL',
                  tool: toolName,
                  status: status
                }, '*');
              }
            };
            
            // Declare agentResponse outside if/else for logging
            let agentResponse: any = null;
            
            // Run agent with streaming if Ollama
            if (provider === 'ollama') {
              let streamingAnswer = '';
              
              if (sidebarIframe && sidebarIframe.contentWindow) {
                sidebarIframe.contentWindow.postMessage({
                  type: 'STREAMING_START',
                  query: message.query
                }, '*');
              }
              
              agentResponse = await orchestrator.runStreaming(agentQuery, conversationHistory, {
                maxSteps: (llmConfig?.maxToolSteps || 3),
                onToolCall: (toolCall) => {
                  logger.log('[ContentScript] Tool call detected:', toolCall.name);
                  sendToolNotification(toolCall.name, 'executing');
                },
                onToolResult: (toolCall, result) => {
                  logger.log('[ContentScript] Tool result:', toolCall.name, result.success ? 'success' : 'failed');
                  sendToolNotification(toolCall.name, result.success ? 'completed' : 'failed');
                },
                onStep: (step, message) => {
                  logger.log(`[ContentScript] Agent step ${step}: ${message}`);
                },
                onChunk: (chunk: string) => {
                  streamingAnswer += chunk;
                  if (sidebarIframe && sidebarIframe.contentWindow) {
                    sidebarIframe.contentWindow.postMessage({
                      type: 'STREAMING_CHUNK',
                      chunk: chunk,
                      accumulated: streamingAnswer
                    }, '*');
                  }
                }
              });
              
              answer = agentResponse.message;
              
              if (sidebarIframe && sidebarIframe.contentWindow) {
                sidebarIframe.contentWindow.postMessage({
                  type: 'STREAMING_COMPLETE',
                  finalAnswer: answer
                }, '*');
              }
            } else {
              // Non-streaming agent mode
              agentResponse = await orchestrator.run(agentQuery, conversationHistory, {
                maxSteps: (llmConfig?.maxToolSteps || 3),
                onToolCall: (toolCall) => {
                  logger.log('[ContentScript] Tool call detected:', toolCall.name);
                  sendToolNotification(toolCall.name, 'executing');
                },
                onToolResult: (toolCall, result) => {
                  logger.log('[ContentScript] Tool result:', toolCall.name, result.success ? 'success' : 'failed');
                  sendToolNotification(toolCall.name, result.success ? 'completed' : 'failed');
                },
                onStep: (step, message) => {
                  logger.log(`[ContentScript] Agent step ${step}: ${message}`);
                }
              });
              
              answer = agentResponse.message;
            }
            
            // Fallback: If agent made tool calls but didn't generate a response, create a summary
            if ((!answer || answer.trim().length === 0) && agentResponse?.toolCalls && agentResponse.toolCalls.length > 0) {
              logger.warn('[ContentScript] Agent made tool calls but no response generated. Creating fallback summary...');
              logger.warn('[ContentScript] Tool calls structure:', JSON.stringify(agentResponse.toolCalls.map((tc: any) => ({
                toolName: tc.toolCall?.name,
                hasResult: !!tc.result,
                resultSuccess: tc.result?.success,
                hasData: !!tc.result?.data
              })), null, 2));
              
              // Extract tool results to create a summary
              const toolResults: any[] = [];
              
              for (const tc of agentResponse.toolCalls) {
                try {
                  if (tc.result?.success && tc.result?.data) {
                    const data = tc.result.data;
                    const toolName = tc.toolCall?.name || '';
                    
                    if (toolName === 'web_search' && data.results && Array.isArray(data.results)) {
                      // Extract web search results
                      const searchResults = data.results.slice(0, 3).map((r: any) => ({
                        title: r.title || 'Untitled',
                        snippet: r.snippet || r.description || '',
                        url: r.url || ''
                      }));
                      toolResults.push(...searchResults);
                    }
                  }
                } catch (error) {
                  console.error('[ContentScript] Error extracting tool result:', error);
                }
              }
              
              if (toolResults.length > 0) {
                try {
                  // In agent mode, llmService might be null, so create a LocalModelService for fallback
                  let fallbackService = llmService;
                  if (!fallbackService) {
                    logger.log('[ContentScript] Creating LocalModelService for fallback summary generation...');
                    const fallbackServiceOptions: any = {
                      provider: provider as any,
                      modelName: llmConfig?.model,
                      requestTimeoutMs: llmConfig?.timeout
                    };
                    
                    if (provider === 'ollama') {
                      let ollamaUrl = llmConfig?.apiUrl || 'http://localhost:11434';
                      ollamaUrl = ollamaUrl
                        .replace(/\/api\/generate$/, '')
                        .replace(/\/api\/chat$/, '')
                        .replace(/\/api\/tags$/, '')
                        .replace(/\/api$/, '')
                        .replace(/\/generate$/, '')
                        .replace(/\/chat$/, '')
                        .replace(/\/$/, '');
                      fallbackServiceOptions.ollamaUrl = `${ollamaUrl}/api/generate`;
                    } else if (provider === 'openai' || provider === 'custom') {
                      fallbackServiceOptions.apiUrl = llmConfig?.apiUrl;
                      fallbackServiceOptions.apiKey = llmConfig?.apiKey;
                    }
                    
                    fallbackService = LocalModelService.getInstance(fallbackServiceOptions);
                    await fallbackService.init();
                  }
                  
                  // Create a prompt to summarize the tool results
                  const summaryPrompt = `Based on the following search results, provide a concise answer to the user's question: "${message.query}"

Search Results:
${toolResults.map((r: any, idx: number) => `${idx + 1}. ${r.title}\n   ${r.snippet}\n   Source: ${r.url}`).join('\n\n')}

Please provide a clear, helpful answer based on these results.`;

                  answer = await fallbackService.generate(summaryPrompt, {
                    max_new_tokens: 400,
                    temperature: 0.4,
                    top_p: 0.9
                  });
                  
                  logger.log('[ContentScript] Fallback summary generated, length:', answer?.length || 0);
                } catch (error) {
                  console.error('[ContentScript] Failed to generate fallback summary:', error);
                  logger.warn('[ContentScript] Will show tool results only without summary');
                  // Format tool results as a readable answer
                  answer = `I found some relevant information from web search:\n\n${toolResults.map((r: any, idx: number) => `${idx + 1}. **${r.title}**\n   ${r.snippet}\n   Source: ${r.url}`).join('\n\n')}`;
                }
              } else {
                logger.warn('[ContentScript] Could not create fallback summary: no tool results extracted');
              }
            }
            
            if (answer) {
              logger.log('[ContentScript] Agent response generated, length:', answer.length, 'characters');
            }
            if (agentResponse) {
              logger.log('[ContentScript] Agent steps:', agentResponse.steps);
              if (agentResponse.toolCalls) {
                logger.log('[ContentScript] Tool calls made:', agentResponse.toolCalls.length);
              }
            }
          } else {
            // Regular mode (non-agent) or fallback from unsupported agent mode
            logger.log('[ContentScript] Regular mode, using direct LLM call');
            
            // Warn if agent mode could be useful but isn't enabled
            const queryLower = message.query.toLowerCase();
            const timeSensitiveKeywords = ['latest', 'recent', 'current', 'today', 'now', 'new', 'news', 'update', 'change'];
            const mightNeedToolCalling = timeSensitiveKeywords.some(keyword => queryLower.includes(keyword));
            
            if (mightNeedToolCalling && !llmConfig?.agentMode) {
              logger.warn('[ContentScript] ⚠️ Query appears to need current information but agent mode is disabled.');
              logger.warn('[ContentScript] Enable agent mode in settings to use web search for latest information.');
              console.warn('[PageRAG] 💡 Tip: Your query mentions time-sensitive terms. Enable "Agent Mode" in settings to use web search for latest information.');
            }
            
            if (!llmService) {
              logger.error('[ContentScript] LLM service not initialized for regular mode');
              safeSendResponse({ 
                success: false, 
                error: 'LLM service not initialized' 
              });
              return;
            }
            
            // TypeScript: llmService is guaranteed to be non-null after the check above
            const service = llmService;
            
            // Build prompt using centralized prompt functions
            const prompt = message.conversationHistory && message.conversationHistory.length > 0
              ? createRAGPromptWithHistory({
                  query: message.query,
                  context,
                  conversationHistory: message.conversationHistory
                })
              : createRAGPromptWithoutHistory({
                  query: message.query,
                  context
                });
            
            // Log the prompt for debugging
            logger.log('[ContentScript] LLM Prompt length:', prompt.length, 'characters');
            logger.log('[ContentScript] LLM Prompt (first 500 chars):', prompt.substring(0, 500) + '...');
            logger.log('[ContentScript] Query:', message.query);
            logger.log('[ContentScript] Calling LLM with context length:', context.length);
            
            // Use streaming for Ollama, non-streaming for others
            if (provider === 'ollama') {
              let streamingAnswer = '';
              
              // Send initial streaming message to sidebar via postMessage
              const sidebarIframe = document.getElementById('rag-sidebar-iframe') as HTMLIFrameElement;
              if (sidebarIframe && sidebarIframe.contentWindow) {
                sidebarIframe.contentWindow.postMessage({
                  type: 'STREAMING_START',
                  query: message.query
                }, '*');
              }
              
              answer = await service.generate(prompt, {
                max_new_tokens: 600,
                temperature: 0.4,
                top_p: 0.9,
                onChunk: (chunk: string) => {
                  streamingAnswer += chunk;
                  // Send streaming chunk to sidebar via postMessage
                  if (sidebarIframe && sidebarIframe.contentWindow) {
                    sidebarIframe.contentWindow.postMessage({
                      type: 'STREAMING_CHUNK',
                      chunk: chunk,
                      accumulated: streamingAnswer
                    }, '*');
                  }
                }
              });
              
              // Send streaming complete message
              if (sidebarIframe && sidebarIframe.contentWindow) {
                sidebarIframe.contentWindow.postMessage({
                  type: 'STREAMING_COMPLETE',
                  finalAnswer: answer
                }, '*');
              }
            } else {
              // Non-streaming for transformers
              answer = await service.generate(prompt, {
                max_new_tokens: 600,
                temperature: 0.4,
                top_p: 0.9
              });
            }
            
            logger.log('[ContentScript] LLM answer generated, length:', answer?.length || 0, 'characters');
            logger.log('[ContentScript] LLM answer:', answer);
            
            // Debugger breakpoint: After LLM call
            if (typeof window !== 'undefined' && window.__DEBUG_LLM_RESULT__) {
              debugger;
            }
          }
        } catch (error) {
          console.error('[ContentScript] LLM generation failed:', error);
          // Continue without answer - will show chunks only
          logger.warn('LLM generation failed, falling back to chunks only');
          
          // Debugger breakpoint: LLM error
          if (typeof window !== 'undefined' && window.__DEBUG_LLM_ERROR__) {
            debugger;
          }
        }
        
        // Generate citation mapping if we have an answer
        let citations: CitationMap = { citations: [] };
        if (answer && results.length > 0) {
          try {
            const embedder = EmbeddingService.getInstance();
            await embedder.init();
            citations = await mapAnswerToSources(answer, results, embedder);
            logger.log('[ContentScript] Generated citations:', citations.citations.length);
          } catch (error) {
            console.error('[ContentScript] Citation mapping failed:', error);
            // Continue without citations
          }
        }
        
        // Debugger breakpoint: Before sending response
        if (typeof window !== 'undefined' && window.__DEBUG_RESPONSE__) {
          debugger;
        }
        
        safeSendResponse({ 
          success: true, 
          results,
          answer: answer || null,
          citations: citations
        });
      })
      .catch((error: any) => {
        console.error('Search error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Debugger breakpoint: Search error
        if (typeof window !== 'undefined' && window.__DEBUG_SEARCH_ERROR__) {
          debugger;
        }
        
        safeSendResponse({ success: false, error: errorMessage });
      });
}

// Initialize RAG (internal function)
async function initRAG() {
  if (isInitializing) {
    logger.log('[PageRAG] Already initializing, skipping...');
    return;
  }
  
  // Check if we already have a RAG instance for this URL
  const currentUrl = window.location.href;
  if (rag && rag.isInitialized()) {
    // Check if URL changed (SPA navigation)
    const ragUrl = (rag as any).url;
    if (ragUrl === currentUrl) {
      logger.log('[PageRAG] Already initialized for this URL, skipping...');
      return;
    } else {
      logger.log('[PageRAG] URL changed, re-initializing...');
      rag = null;
    }
  }
  
  isInitializing = true;
  
  try {
    logger.log('[PageRAG] Starting initialization...');
    logger.log('[PageRAG] URL:', currentUrl);
    rag = new PageRAG();
    await rag.init();
      logger.log('[PageRAG] ✅ Initialized successfully with', rag.getChunks().length, 'chunks');
  } catch (error) {
    console.error('[PageRAG] ❌ Failed to initialize:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[PageRAG] Error details:', errorMessage);
    rag = null;
  } finally {
    isInitializing = false;
  }
}

// Ensure RAG is initialized (called when user explicitly interacts with plugin)
async function ensureRAGInitialized(): Promise<void> {
  if (rag && rag.isInitialized()) {
    // Check if URL changed (SPA navigation)
    const currentUrl = window.location.href;
    const ragUrl = (rag as any).url;
    if (ragUrl === currentUrl) {
      logger.log('[PageRAG] Already initialized for this URL');
      return;
    } else {
      logger.log('[PageRAG] URL changed, resetting...');
      rag = null;
    }
  }
  
  if (!rag || !rag.isInitialized()) {
    await initRAG();
  }
}

// Wait for DOM to be ready - only restore sidebar state, don't auto-initialize RAG
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    restoreSidebarState();
  });
} else {
  restoreSidebarState();
}

// Track URL changes and reset RAG instance, but don't auto-initialize
let lastUrl = location.href;

new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    logger.log('[PageRAG] URL changed, resetting RAG instance (will initialize on user action)');
    rag = null; // Reset but don't initialize
    isInitializing = false; // Reset initialization flag
  }
}).observe(document, { subtree: true, childList: true });

// Sidebar management functions
function createSidebar(): HTMLDivElement {
  // Check if sidebar already exists in DOM (even if sidebarContainer is null)
  const existingSidebar = document.getElementById('rag-sidebar-container');
  if (existingSidebar) {
    sidebarContainer = existingSidebar as HTMLDivElement;
    return sidebarContainer;
  }
  
  // Also check if sidebarContainer is set and still in DOM
  if (sidebarContainer && document.body.contains(sidebarContainer)) {
    return sidebarContainer;
  }
  
  // Reset sidebarContainer if it's not in DOM
  if (sidebarContainer && !document.body.contains(sidebarContainer)) {
    sidebarContainer = null;
  }
  
  const container = document.createElement('div');
  container.id = 'rag-sidebar-container';
  
  // Create resize handles
  const resizeHandle = document.createElement('div');
  resizeHandle.id = 'rag-sidebar-resize-handle';
  
  // Height resize handle (top bar - draggable)
  const resizeHeightHandle = document.createElement('div');
  resizeHeightHandle.className = 'resize-height-handle';
  
  // Corner resize handle (top-right corner)
  const resizeCornerHandle = document.createElement('div');
  resizeCornerHandle.className = 'resize-corner-handle';
  
  const iframe = document.createElement('iframe');
  iframe.id = 'rag-sidebar-iframe';
  iframe.src = chrome.runtime.getURL('sidebar.html');
  
  container.appendChild(resizeHandle);
  container.appendChild(resizeHeightHandle);
  container.appendChild(resizeCornerHandle);
  container.appendChild(iframe);
  document.body.appendChild(container);
  
  // Add resize functionality
  let isResizingWidth = false;
  let isResizingHeight = false;
  let isResizingCorner = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  
  // Width resize (left edge)
  resizeHandle.addEventListener('mousedown', (e) => {
    isResizingWidth = true;
    startX = e.clientX;
    startWidth = container.offsetWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  });
  
  // Height resize (top bar) - only on left side, not near close button
  resizeHeightHandle.addEventListener('mousedown', (e) => {
    // Don't start resize if clicking near the right edge (where close button is)
    if (e.clientX > container.offsetWidth - 60) {
      return; // Let the click pass through to close button
    }
    isResizingHeight = true;
    startY = e.clientY;
    startHeight = container.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  });
  
  // Corner resize (top-right corner - both width and height) - smaller area
  resizeCornerHandle.addEventListener('mousedown', (e) => {
    // Don't start resize if clicking too close to the right edge
    if (e.clientX > container.offsetWidth - 50) {
      return; // Let the click pass through
    }
    isResizingCorner = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = container.offsetWidth;
    startHeight = container.offsetHeight;
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (isResizingWidth) {
      const diff = startX - e.clientX; // Negative because we're resizing from right
      const newWidth = Math.max(300, Math.min(800, startWidth + diff)); // Min 300px, max 800px
      container.style.width = `${newWidth}px`;
      e.preventDefault();
    } else if (isResizingHeight) {
      const diff = e.clientY - startY; // Positive when dragging down
      const newHeight = Math.max(300, Math.min(window.innerHeight, startHeight + diff)); // Min 300px, max viewport
      container.style.height = `${newHeight}px`;
      container.classList.remove('expanded'); // Remove auto-expand class when manually resized
      e.preventDefault();
    } else if (isResizingCorner) {
      // Resize both width and height
      const widthDiff = startX - e.clientX;
      const heightDiff = e.clientY - startY;
      const newWidth = Math.max(300, Math.min(800, startWidth + widthDiff));
      const newHeight = Math.max(300, Math.min(window.innerHeight, startHeight + heightDiff));
      container.style.width = `${newWidth}px`;
      container.style.height = `${newHeight}px`;
      container.classList.remove('expanded'); // Remove auto-expand class when manually resized
      e.preventDefault();
    }
  });
  
  document.addEventListener('mouseup', () => {
    if (isResizingWidth || isResizingHeight || isResizingCorner) {
      isResizingWidth = false;
      isResizingHeight = false;
      isResizingCorner = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
  
  // Listen for messages from sidebar to auto-expand
  // Only auto-expand if user hasn't manually resized
  let hasManualResize = false;
  window.addEventListener('message', (event) => {
    // Only accept messages from our extension
    if (event.data && event.data.type === '__RAG_SIDEBAR_EXPAND__') {
      if (!hasManualResize) {
        container.classList.add('expanded');
      }
    } else if (event.data && event.data.type === '__RAG_SIDEBAR_COLLAPSE__') {
      if (!hasManualResize) {
        container.classList.remove('expanded');
      }
    }
  });
  
  // Track manual resize
  const trackManualResize = () => {
    hasManualResize = true;
    container.classList.remove('expanded'); // Remove auto-expand when manually resized
  };
  
  resizeHandle.addEventListener('mousedown', trackManualResize);
  resizeHeightHandle.addEventListener('mousedown', trackManualResize);
  resizeCornerHandle.addEventListener('mousedown', trackManualResize);
  
  sidebarContainer = container;
  return container;
}

async function showSidebar(): Promise<void> {
  // DON'T initialize RAG immediately - show settings first if first time
  // RAG will be initialized when user searches or after settings are saved
  
  // First, check if there are any duplicate sidebars and remove them
  const allSidebars = document.querySelectorAll('#rag-sidebar-container');
  if (allSidebars.length > 1) {
    logger.warn(`[ContentScript] Found ${allSidebars.length} sidebar instances, removing duplicates`);
    // Keep the first one, remove the rest
    for (let i = 1; i < allSidebars.length; i++) {
      allSidebars[i].remove();
    }
  }
  
  const container = createSidebar();
  container.classList.add('visible');
  // Save state to storage
  try {
    await chrome.storage.local.set({ [SIDEBAR_STORAGE_KEY]: true });
  } catch (e) {
    console.warn('[ContentScript] Failed to save sidebar state:', e);
  }
  
  // Check if it's first time use and auto-open settings
  await checkAndOpenSettingsIfFirstTime(container);
}

/**
 * Check if it's first time use and open settings automatically
 */
async function checkAndOpenSettingsIfFirstTime(container: HTMLDivElement): Promise<void> {
  try {
    // Check if user has configured settings before
    const hasConfiguredSettings = await chrome.storage.local.get('rag_settings_configured');
    
    if (!hasConfiguredSettings.rag_settings_configured) {
      // Check if config exists and is customized (not just default)
      const llmConfig = await getLLMConfig().catch(() => null);
      
      // Consider it first time if:
      // 1. No configured flag exists, AND
      // 2. Config is default or doesn't have a model selected
      const isFirstTime = !llmConfig || 
                         !llmConfig.model || 
                         (llmConfig.provider === 'transformers' && llmConfig.model === 'Xenova/LaMini-Flan-T5-783M' && !llmConfig.enabled);
      
      if (isFirstTime) {
        logger.log('[ContentScript] First time use detected - opening settings');
        
        // Wait for iframe to load
        const iframe = container.querySelector('#rag-sidebar-iframe') as HTMLIFrameElement;
        if (iframe) {
          // Wait for iframe to be ready
          const waitForIframe = () => {
            return new Promise<void>((resolve) => {
              if (iframe.contentWindow) {
                // Try to send message
                try {
                  iframe.contentWindow.postMessage({ type: 'OPEN_SETTINGS_FIRST_TIME' }, '*');
                  logger.log('[ContentScript] Sent OPEN_SETTINGS_FIRST_TIME message to sidebar');
                  resolve();
                } catch (e) {
                  // Iframe might not be ready yet, wait a bit
                  setTimeout(() => {
                    try {
                      iframe.contentWindow?.postMessage({ type: 'OPEN_SETTINGS_FIRST_TIME' }, '*');
                      logger.log('[ContentScript] Sent OPEN_SETTINGS_FIRST_TIME message to sidebar (retry)');
                      resolve();
                    } catch (e2) {
                      logger.warn('[ContentScript] Could not send message to sidebar iframe:', e2);
                      resolve();
                    }
                  }, 500);
                }
              } else {
                // Iframe not loaded yet, wait
                setTimeout(() => {
                  waitForIframe().then(resolve);
                }, 100);
              }
            });
          };
          
          // Wait a bit for iframe to load, then send message
          setTimeout(async () => {
            await waitForIframe();
          }, 300);
        }
      }
    }
  } catch (error) {
    logger.warn('[ContentScript] Error checking first time use:', error);
    // Don't block sidebar opening if check fails
  }
}

async function hideSidebar(): Promise<void> {
  if (sidebarContainer) {
    sidebarContainer.classList.remove('visible');
  }
  // Save state to storage
  try {
    await chrome.storage.local.set({ [SIDEBAR_STORAGE_KEY]: false });
  } catch (e) {
    console.warn('[ContentScript] Failed to save sidebar state:', e);
  }
}

async function toggleSidebar(): Promise<void> {
  if (sidebarContainer && sidebarContainer.classList.contains('visible')) {
    await hideSidebar();
  } else {
    await showSidebar();
  }
}

// Restore sidebar state on page load
async function restoreSidebarState(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(SIDEBAR_STORAGE_KEY);
    if (result[SIDEBAR_STORAGE_KEY] === true) {
      // Wait a bit for DOM to be ready
      setTimeout(() => {
        // Check if sidebar already exists before showing
        const existingSidebar = document.getElementById('rag-sidebar-container');
        if (!existingSidebar) {
          showSidebar();
        } else {
          // Sidebar already exists, just make it visible
          existingSidebar.classList.add('visible');
          sidebarContainer = existingSidebar as HTMLDivElement;
        }
      }, 500);
    }
  } catch (e) {
    console.warn('[ContentScript] Failed to restore sidebar state:', e);
  }
}

function getElementFromChunk(chunk: any): HTMLElement | null {
  // Try CSS selector first (more reliable)
  if (chunk.metadata?.cssSelector) {
    try {
      const element = document.querySelector(chunk.metadata.cssSelector);
      if (element && element instanceof HTMLElement) {
        return element;
      }
    } catch (e) {
      console.warn('[ContentScript] Failed to find element by CSS selector:', e);
    }
  }
  
  // Fallback to XPath
  if (chunk.metadata?.xpath) {
    try {
      const result = document.evaluate(
        chunk.metadata.xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const node = result.singleNodeValue;
      if (node && node instanceof HTMLElement) {
        return node;
      }
    } catch (e) {
      console.warn('[ContentScript] Failed to find element by XPath:', e);
    }
  }
  
  // Last resort: Try to find by heading path
  if (chunk.metadata?.headingPath && chunk.metadata.headingPath.length > 0) {
    const headingText = chunk.metadata.headingPath[chunk.metadata.headingPath.length - 1];
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[];
    const matchingHeading = headings.find(h => h.textContent?.trim() === headingText);
    if (matchingHeading) {
      // Find the next sibling element that contains content
      let current = matchingHeading.nextElementSibling;
      while (current) {
        if (current instanceof HTMLElement && current.textContent?.trim()) {
          return current;
        }
        current = current.nextElementSibling;
      }
      return matchingHeading;
    }
  }
  
  return null;
}

/**
 * Highlight and scroll to a chunk element
 */
function highlightAndScrollToChunk(chunk: any): void {
  const element = getElementFromChunk(chunk);
  
  if (!element) {
    console.warn('[ContentScript] Could not find element for chunk:', chunk.id);
    // Try to find by text content as last resort
    const text = chunk.metadata?.raw_text || chunk.text;
    if (text) {
      const textNodes = Array.from(document.querySelectorAll('*')).filter(el => {
        return el.textContent?.includes(text.substring(0, 50));
      });
      if (textNodes.length > 0) {
        const foundElement = textNodes[0] as HTMLElement;
        scrollAndHighlight(foundElement);
        return;
      }
    }
    return;
  }
  
  scrollAndHighlight(element);
}

/**
 * Scroll to element and highlight it
 */
function scrollAndHighlight(element: HTMLElement): void {
  // Remove any existing highlights first
  document.querySelectorAll('.rag-highlight').forEach(el => {
    el.classList.remove('rag-highlight');
  });
  
  // Scroll to element with smooth behavior
  element.scrollIntoView({ 
    behavior: 'smooth', 
    block: 'center',
    inline: 'nearest'
  });
  
  // Add highlight class
  element.classList.add('rag-highlight');
  
  // Remove highlight after 5 seconds (increased from 3)
  setTimeout(() => {
    element.classList.remove('rag-highlight');
  }, 5000);
  
  // Also try to focus the element if it's focusable
  if (element.tabIndex >= 0 || element.tagName === 'A' || element.tagName === 'BUTTON') {
    try {
      element.focus();
    } catch (e) {
      // Ignore focus errors
    }
  }
  
  logger.log('[ContentScript] ✅ Navigated to chunk element:', element.tagName, element.id, element.className);
}

// Export LLM config helpers to window for console access
// This makes configureLLMExtraction available in the main page console
(async () => {
  try {
    // LLM config helpers are already imported at the top
    
    (window as any).configureLLMExtraction = async (config: any) => {
      try {
        await saveLLMConfig(config);
        console.log('✅ LLM config saved. Reload page to apply.');
        console.log('Config:', config);
        return config;
      } catch (error) {
        console.error('Failed to save LLM config:', error);
        // Fallback: save directly to localStorage
        localStorage.setItem('llmConfig', JSON.stringify(config));
        console.log('✅ Config saved to localStorage as fallback. Reload page to apply.');
        return config;
      }
    };
    
    (window as any).getLLMConfig = async () => {
      try {
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
    
    // Debug helper functions
    (window as any).debugSearch = async (query: string, options?: any) => {
      logger.log('[Debug] Testing search with query:', query);
      if (!rag || !rag.isInitialized()) {
        logger.warn('[Debug] RAG not initialized. Initializing...');
        await ensureRAGInitialized();
      }
      
      if (!rag || !rag.isInitialized()) {
        console.error('[Debug] Failed to initialize RAG');
        return null;
      }
      
      try {
        const results = await rag.search(query, options || { limit: 10 });
        console.log('[Debug] Search results:', results);
        console.table(results.map((r: any) => ({
          score: r.score.toFixed(3),
          text: r.chunk.text.substring(0, 50) + '...',
          id: r.chunk.id
        })));
        return results;
      } catch (error) {
        console.error('[Debug] Search error:', error);
        throw error;
      }
    };
    
    (window as any).debugRAG = () => {
      if (!rag) {
        console.warn('[Debug] RAG not initialized');
        return null;
      }
      
      const state = {
        initialized: rag.isInitialized(),
        chunkCount: rag.getChunks().length,
        chunks: rag.getChunks().slice(0, 5).map((c: any) => ({
          id: c.id,
          text: c.text.substring(0, 100) + '...',
          headingPath: c.metadata?.headingPath || []
        })),
        isInitializing: isInitializing
      };
      
      console.log('[Debug] RAG State:', state);
      return state;
    };
    
    window.debugMessages = () => {
      if (window.chromeMessageHistory) {
        console.table(window.chromeMessageHistory);
        return window.chromeMessageHistory;
      } else {
        console.log('[Debug] Message history not available (not in test environment)');
        return [];
      }
    };
    
    (window as any).debugLLM = async (prompt: string, config?: any) => {
      logger.log('[Debug] Testing LLM with prompt:', prompt.substring(0, 100) + '...');
      
      try {
        const llmConfig = config || await getLLMConfig().catch(() => null);
        if (!llmConfig) {
          console.error('[Debug] LLM config not available');
          return null;
        }
        
        const provider = llmConfig.provider || 'transformers';
        const llmServiceOptions: any = {
          provider: provider as any,
          modelName: llmConfig?.model,
          requestTimeoutMs: llmConfig?.timeout
        };
        
        if (provider === 'ollama') {
          let ollamaUrl = llmConfig?.apiUrl || 'http://localhost:11434';
          ollamaUrl = ollamaUrl
            .replace(/\/api\/generate$/, '')
            .replace(/\/api\/chat$/, '')
            .replace(/\/$/, '');
          llmServiceOptions.ollamaUrl = `${ollamaUrl}/api/generate`;
        } else if (provider === 'openai' || provider === 'custom') {
          llmServiceOptions.apiUrl = llmConfig?.apiUrl;
          llmServiceOptions.apiKey = llmConfig?.apiKey;
        }
        
        const llmService = LocalModelService.getInstance(llmServiceOptions);
        await llmService.init();
        
        const response = await llmService.generate(prompt, {
          max_new_tokens: 200,
          temperature: 0.4
        });
        
        console.log('[Debug] LLM Response:', response);
        return response;
      } catch (error) {
        console.error('[Debug] LLM error:', error);
        throw error;
      }
    };
    
    // Expose message handler for test environment
    (window as any).handleSearchMessage = handleSearch;
    
    console.log('✅ Debug functions available:');
    console.log('  - window.debugSearch(query, options) - Test search directly');
    console.log('  - window.debugRAG() - Inspect RAG state');
    console.log('  - window.debugMessages() - View message history');
    console.log('  - window.debugLLM(prompt, config) - Test LLM directly');
    
  } catch (error) {
    console.error('Failed to load LLM config helpers:', error);
  }
})();

