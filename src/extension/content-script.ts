/**
 * Content Script - Runs on every page
 */

import { PageRAG } from '../core/PageRAG';
import { logger } from '../utils/logger';
import { LocalModelService } from '../core/LocalModelService';
import { getLLMConfig } from '../utils/llmContentExtraction';
import { EmbeddingService } from '../core/EmbeddingService';
import type { SearchResult } from '../types';

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
    top: 0;
    right: 0;
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
    height: 100vh;
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
    position: absolute;
    top: 0;
    left: 0;
    right: 50px; /* Leave space for close button */
    height: 40px;
    cursor: ns-resize;
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

let rag: PageRAG | null = null;
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
    
    sourceEmbeddings.forEach((sourceEmbedding, sourceIndex) => {
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

// Message listener - set up once, outside init function
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
 // logger.log('Content script received message:', message.type);
  
  // Handle ping for checking if content script is loaded
  if (message.type === 'PING') {
    sendResponse({ pong: true });
    return false; // Synchronous response
  }
  
  if (message.type === 'SEARCH') {
    if (!rag || !rag.isInitialized()) {
      sendResponse({ 
        success: false, 
        error: 'PageRAG not initialized yet. Please wait...' 
      });
      return false;
    }
    
    rag.search(message.query, message.options)
      .then(async results => {
        logger.log('[ContentScript] Search returned results:', results.length);
        
        // Validate search results
        if (results.length === 0) {
          logger.warn('[ContentScript] No search results found for query:', message.query);
          sendResponse({ 
            success: true, 
            results: [],
            answer: 'I couldn\'t find any relevant information on this page to answer your question. Try rephrasing your query or asking about a different topic.',
            citations: { citations: [] }
          });
          return;
        }
        
        // Log search results details
        logger.log('[ContentScript] Top search results:');
        results.slice(0, 5).forEach((result, idx) => {
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
        const validChunks = topChunks.filter(result => {
          const chunkText = result.chunk.metadata?.raw_text || result.chunk.text;
          const hasContent = chunkText && chunkText.trim().length > 10; // At least 10 chars
          if (!hasContent) {
            logger.warn(`[ContentScript] Chunk ${result.chunk.id} is empty or too short: "${chunkText}"`);
          }
          return hasContent;
        });
        
        if (validChunks.length === 0) {
          logger.warn('[ContentScript] All chunks are empty or invalid');
          sendResponse({ 
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
          .map((result, idx) => {
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
          sendResponse({ 
            success: true, 
            results,
            answer: 'I found some information, but it\'s not enough to provide a comprehensive answer. Try asking a more specific question.',
            citations: { citations: [] }
          });
          return;
        }
        
        try {
          // Build prompt with conversation history if available
          // Enhanced prompt to encourage detailed, comprehensive answers
          let prompt = '';
          
          // Add conversation history context (last 5-10 messages)
          // Simplified prompt format optimized for T5/Flan models
          if (message.conversationHistory && message.conversationHistory.length > 0) {
            const recentHistory = message.conversationHistory.slice(-10);
            const historyText = recentHistory
              .map((msg: { role: string; content: string }) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
              .join('\n');
            
            // Simplified prompt for T5 models - more direct and less verbose
            prompt = `Based on the context below, answer the question. Provide a detailed answer. If the answer is not in the context, say "I cannot find this information in the provided context."

Previous conversation:
${historyText}

Question: ${message.query}

Context:
${context}

Answer:`;
          } else {
            // No conversation history - simplified prompt for T5
            prompt = `Based on the context below, answer the question. Provide a detailed answer. If the answer is not in the context, say "I cannot find this information in the provided context."

Question: ${message.query}

Context:
${context}

Answer:`;
          }
          
          // Initialize and call LLM
          const llmConfig = await getLLMConfig().catch(() => null);
          const provider = llmConfig?.provider === 'ollama' ? 'ollama' : 'transformers';
          const llmService = LocalModelService.getInstance({
            provider,
            modelName: llmConfig?.model,
            ollamaUrl: llmConfig?.apiUrl,
            requestTimeoutMs: llmConfig?.timeout
          });
          await llmService.init();
          
          // Log the prompt for debugging
          logger.log('[ContentScript] LLM Prompt length:', prompt.length, 'characters');
          logger.log('[ContentScript] LLM Prompt (first 500 chars):', prompt.substring(0, 500) + '...');
          logger.log('[ContentScript] Query:', message.query);
          logger.log('[ContentScript] Calling LLM with context length:', context.length);
          
          answer = await llmService.generate(prompt, {
            max_new_tokens: 600, // Increased from 300 to 600 for longer responses
            temperature: 0.4, // Slightly increased for more natural responses
            top_p: 0.9
          });
          
          logger.log('[ContentScript] LLM answer generated, length:', answer.length, 'characters');
          logger.log('[ContentScript] LLM answer:', answer);
        } catch (error) {
          console.error('[ContentScript] LLM generation failed:', error);
          // Continue without answer - will show chunks only
          logger.warn('LLM generation failed, falling back to chunks only');
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
        
        sendResponse({ 
          success: true, 
          results,
          answer: answer || null,
          citations: citations
        });
      })
      .catch(error => {
        console.error('Search error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        sendResponse({ success: false, error: errorMessage });
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
    showSidebar();
    sendResponse({ success: true });
    return false;
  }
  
  if (message.type === 'HIDE_SIDEBAR') {
    hideSidebar();
    sendResponse({ success: true });
    return false;
  }
  
  if (message.type === 'TOGGLE_SIDEBAR') {
    toggleSidebar();
    sendResponse({ success: true });
    return false;
  }
  
  if (message.type === 'HIGHLIGHT_RESULT') {
    if (rag && message.chunkId) {
      const chunks = rag.getChunks();
      const chunk = chunks.find(c => c.id === message.chunkId);
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
  
  return false;
});

// Initialize on page load
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

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    logger.log('[PageRAG] DOM loaded, initializing...');
    initRAG();
    restoreSidebarState();
  });
} else {
  logger.log('[PageRAG] DOM already ready, initializing...');
  initRAG();
  restoreSidebarState();
}

// Re-initialize on SPA navigation (with debounce)
let lastUrl = location.href;
let navigationTimeout: NodeJS.Timeout | null = null;

new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    
    // Debounce navigation detection
    if (navigationTimeout) {
      clearTimeout(navigationTimeout);
    }
    
    navigationTimeout = setTimeout(() => {
      logger.log('[PageRAG] URL changed, re-initializing...');
      rag = null;
      initRAG();
    }, 500);
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

