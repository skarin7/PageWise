/**
 * DOM Chunker - Semantic HTML parsing with heading-based chunking
 */

import { Readability } from '@mozilla/readability';
import type { Chunk, HeadingNode } from '../types';
import { getXPath, getCssSelector, isVisible, extractTextContent, removeLinks } from '../utils/domHelpers';
import { findMainContentByHeuristics, calculateContentScore } from '../utils/contentExtraction';
import { findMainContentByLLM, getLLMConfig, type LLMConfig } from '../utils/llmContentExtraction';
import { buildHeadingHierarchy, findNextHeading, getHeadingPath } from '../utils/headingHierarchy';
import { htmlToMarkdown } from '../utils/markdownConverter';
import { filterChunksByRelevance, removeBoilerplate } from '../utils/contentFilter';
import { logger } from '../utils/logger';

export class DomChunker {
  private url: string;
  private llmConfig: LLMConfig | null = null;

  constructor(url?: string) {
    this.url = url || window.location.href;
  }

  /**
   * Set LLM configuration for content extraction
   */
  async setLLMConfig(config: LLMConfig): Promise<void> {
    this.llmConfig = config;
  }

  /**
   * Extract clean article text via Readability (run on a doc clone).
   * Returns empty string for non-article pages — caller treats absence as "no filter".
   */
  private extractArticleText(doc: Document | null): string {
    if (!doc) return '';
    try {
      const clone = doc.cloneNode(true) as Document;
      const parsed = new Readability(clone).parse();
      return parsed?.textContent || '';
    } catch (err) {
      logger.warn('[DomChunker] Readability failed:', err);
      return '';
    }
  }

  /**
   * Keep chunks whose words substantially overlap with Readability's article text.
   * This removes nav/footer/comments noise without touching xpath/cssSelector —
   * those still point at the live DOM, so click-to-navigate keeps working.
   */
  private filterChunksByOverlap(chunks: Chunk[], articleText: string): Chunk[] {
    const articleWords = new Set(
      articleText.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
    );
    if (articleWords.size < 20) return chunks; // too little signal — don't filter

    const kept: Chunk[] = [];
    for (const chunk of chunks) {
      const meaningful = chunk.metadata.raw_text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3);

      if (meaningful.length === 0) continue;
      const overlap = meaningful.filter(w => articleWords.has(w)).length;
      const ratio = overlap / meaningful.length;
      if (ratio > 0.5) kept.push(chunk);
    }

    // Safety: if filter discards everything, fall back to unfiltered chunks.
    // Readability sometimes returns too narrow an article for sites with
    // multiple sections (e.g. listicles, sidebars-as-content).
    if (kept.length === 0 && chunks.length > 0) {
      logger.warn('[DomChunker] Overlap filter discarded all chunks — falling back to unfiltered');
      return chunks;
    }

    logger.log(`[DomChunker] Readability filter: kept ${kept.length}/${chunks.length} chunks`);
    return kept;
  }

  /**
   * Split a chunk whose text exceeds maxChars into multiple smaller chunks,
   * preserving all metadata (heading path, xpath, etc.) on each split.
   * Splits on sentence boundaries to avoid mid-sentence cuts that degrade embeddings.
   */
  private splitLargeChunk(chunk: Chunk, maxChars = 1500): Chunk[] {
    if (chunk.text.length <= maxChars) return [chunk];

    const sentences = chunk.text.match(/[^.!?]+[.!?]+\s*/g) || [chunk.text];
    const parts: Chunk[] = [];
    let current = '';
    let partIndex = 0;

    const flush = () => {
      if (!current.trim()) return;
      parts.push({
        ...chunk,
        id: `${chunk.id}-part${partIndex++}`,
        text: current.trim(),
        metadata: { ...chunk.metadata, raw_text: current.trim() }
      });
      current = '';
    };

    for (const sentence of sentences) {
      if (current.length + sentence.length > maxChars && current.length > 0) {
        flush();
      }
      current += sentence;
    }
    flush();

    return parts.length > 0 ? parts : [chunk];
  }

  /**
   * Main chunking method
   */
  async chunk(document: Document | HTMLElement): Promise<Chunk[]> {
    const root = document instanceof Document ? document.body : document;
    const chunks: Chunk[] = [];

    // Step 0: Try Readability on a doc clone to identify clean article text.
    // Used as a NOISE FILTER later — we still chunk the live DOM so that
    // xpath/cssSelector remain valid for click-to-navigate.
    const ownerDoc = root.ownerDocument || (document instanceof Document ? document : null);
    const articleText = this.extractArticleText(ownerDoc);

    // Step 1: Find main content area
    const mainContent = await this.findMainContent(root);
    if (!mainContent || mainContent === root) {
      // If mainContent is body or null, it's still valid - just log it
      if (mainContent === root) {
        logger.log('[DomChunker] Using body as main content (this is normal for some pages)');
      } else {
        logger.warn('[DomChunker] No main content found, using body as fallback');
      }
      
      // Use body directly - this is fine, many pages don't have semantic main tags
      // Exclude iframes and their content
      const bodyHeadings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[];
      const visibleBodyHeadings = bodyHeadings.filter(h => {
        if (!isVisible(h)) return false;
        // Exclude headings inside iframes
        if (h.closest('iframe')) return false;
        return true;
      });
      
      if (visibleBodyHeadings.length > 0) {
        logger.log(`[DomChunker] Found ${visibleBodyHeadings.length} headings in body, chunking by headings`);
        const headingTree = buildHeadingHierarchy(visibleBodyHeadings);
        chunks.push(...this.createChunksFromHeadingTree(headingTree, root));
      } else {
        // Last resort: chunk entire body by sections
        logger.log('[DomChunker] No headings found, chunking body by semantic sections');
        chunks.push(...this.createChunksFromSemanticTags(root));
      }
      
      // Apply processing pipeline
      let processed = this.deduplicateChunks(chunks);
      processed = removeBoilerplate(processed);
      processed = filterChunksByRelevance(processed, {
        minQualityScore: -5,
        minBM25Score: 0,
        removeDuplicates: true
      });
      // Readability noise filter (no-op if Readability returned nothing)
      if (articleText && articleText.length > 200) {
        processed = this.filterChunksByOverlap(processed, articleText);
      }
      // Split oversized chunks for better embedding quality
      processed = processed.flatMap(c => this.splitLargeChunk(c));
      logger.log(`[DomChunker] Final chunks: ${processed.length}`);
      return processed;
    }

    logger.log(`[DomChunker] Main content found: ${mainContent.tagName}${mainContent.id ? '#' + mainContent.id : ''}${mainContent.className ? '.' + mainContent.className.split(' ')[0] : ''}`);

    // Step 2: Build heading hierarchy (exclude iframes)
    const headings = Array.from(mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[];
    const visibleHeadings = headings.filter(h => {
      if (!isVisible(h)) return false;
      // Exclude headings inside iframes
      if (h.closest('iframe')) return false;
      return true;
    });
    
    logger.log(`[DomChunker] Found ${headings.length} total headings, ${visibleHeadings.length} visible`);

    if (visibleHeadings.length > 0) {
      // PRIMARY: Heading-based chunking
      const headingTree = buildHeadingHierarchy(visibleHeadings);
      const headingChunks = this.createChunksFromHeadingTree(headingTree, mainContent);
      chunks.push(...headingChunks);
      logger.log(`[DomChunker] Created ${headingChunks.length} chunks from heading tree`);
      
      // ALSO: Create chunks for content sections that don't have headings
      // This ensures we capture content that's not under any heading
      const contentChunks = this.createChunksFromNonHeadingContent(mainContent, visibleHeadings);
      chunks.push(...contentChunks);
      logger.log(`[DomChunker] Created ${contentChunks.length} additional chunks from non-heading content`);
    } else {
      // FALLBACK: Use semantic tags
      logger.log('[DomChunker] No visible headings, using semantic tags fallback');
      chunks.push(...this.createChunksFromSemanticTags(mainContent));
      logger.log(`[DomChunker] Created ${chunks.length} chunks from semantic tags`);
    }

    // Step 1: Deduplicate
    let processed = this.deduplicateChunks(chunks);
    logger.log(`[DomChunker] After deduplication: ${processed.length} chunks`);
    
    // Step 2: Remove boilerplate
    processed = removeBoilerplate(processed);
    logger.log(`[DomChunker] After boilerplate removal: ${processed.length} chunks`);
    
    // Step 3: Filter by relevance (BM25 + quality scoring)
    processed = filterChunksByRelevance(processed, {
      minQualityScore: -5, // Allow some negative scores
      minBM25Score: 0,
      removeDuplicates: true
    });
    logger.log(`[DomChunker] After relevance filtering: ${processed.length} chunks`);

    // Readability-based noise filter (no-op when not an article page)
    if (articleText && articleText.length > 200) {
      processed = this.filterChunksByOverlap(processed, articleText);
    }

    // Split oversized chunks so embeddings stay accurate
    processed = processed.flatMap(c => this.splitLargeChunk(c));

    logger.log(`[DomChunker] Final chunks: ${processed.length}`);
    return processed;
  }

  /**
   * Find main content area
   */
  private async findMainContent(root: HTMLElement): Promise<HTMLElement | null> {
    // Try semantic HTML first
    const main = root.querySelector('main') || root.querySelector('[role="main"]');
    if (main && isVisible(main as HTMLElement)) {
      logger.log('[DomChunker] Found main content via semantic HTML:', main.tagName);
      return main as HTMLElement;
    }

    // Try common content containers — pick the BEST-scoring match across all selectors,
    // not the first DOM match (which is often a cookie banner or layout wrapper).
    const contentSelectors = [
      '[class*="content"]',
      '[class*="main"]',
      '[id*="content"]',
      '[id*="main"]',
      'article',
      'section[class*="content"]'
    ];

    const candidates: Array<{ el: HTMLElement; score: number; selector: string }> = [];
    for (const selector of contentSelectors) {
      const matches = Array.from(root.querySelectorAll(selector)) as HTMLElement[];
      for (const el of matches) {
        if (!isVisible(el)) continue;
        if ((el.textContent || '').trim().length < 100) continue;
        candidates.push({ el, score: calculateContentScore(el), selector });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best && best.score > 0) {
      logger.log(`[DomChunker] Best-match content (score ${best.score.toFixed(1)}) via "${best.selector}":`, best.el.tagName);
      return best.el;
    }

    // Try LLM-based extraction if enabled
    // Use the same config that's used for search/RAG
    const config = this.llmConfig || await getLLMConfig();
    // If config exists and has a provider, use it (enabled flag is checked inside findMainContentByLLM)
    // This ensures the same config is used for both extraction and search/RAG
    if (config && (config.enabled || config.provider)) {
      try {
        const llmResult = await findMainContentByLLM(root.ownerDocument || document, config);
        if (llmResult) {
          logger.log('[DomChunker] ✅ Found main content via LLM:', llmResult.tagName);
          return llmResult;
        }
      } catch (error) {
        logger.warn('[DomChunker] LLM extraction failed, falling back to heuristics:', error);
      }
    }

    // Fallback: Use heuristics
    const heuristicResult = findMainContentByHeuristics(root.ownerDocument || document);
    if (heuristicResult) {
      logger.log('[DomChunker] Found main content via heuristics:', heuristicResult.tagName);
    } else {
      logger.warn('[DomChunker] Heuristics failed to find main content');
    }
    return heuristicResult;
  }

  /**
   * Create chunks from heading tree
   */
  private createChunksFromHeadingTree(
    headingTree: HeadingNode[],
    mainContent: HTMLElement
  ): Chunk[] {
    const chunks: Chunk[] = [];

    const processNode = (node: HeadingNode, parentPath: string[] = []) => {
      const headingPath = [...parentPath, node.text];
      const nextHeading = findNextHeading(node.element, mainContent);
      const content = this.extractContentUnderHeading(node.element, nextHeading);

      // Only create chunk if there's substantial content (not just heading text)
      // Minimum content length to avoid creating chunks with only heading text
      const minContentLength = 30; // Minimum characters of actual content (excluding heading)
      
      if (content.trim() && content.trim().length >= minContentLength) {
        // Extract content element for markdown conversion
        const contentElement = this.getContentElement(node.element, nextHeading, mainContent);
        const markdown = contentElement ? htmlToMarkdown(contentElement) : content;
        
        // Create semantic text with heading path
        const semanticText = headingPath
          .map((h, i) => `[H${i + 1}: ${h}]`)
          .join(' ') + ` ${content}`;

        chunks.push({
          id: `heading-${node.level}-${this.sanitizeId(headingPath.join('-'))}`,
          text: semanticText,
          metadata: {
            headingPath,
            semanticTag: node.element.tagName.toLowerCase(),
            headingLevel: node.level,
            parentChunkId:
              parentPath.length > 0
                ? `heading-${this.sanitizeId(parentPath.join('-'))}`
                : undefined,
            contentType: 'mixed',
            raw_text: content,
            markdown: markdown, // Add markdown version
            xpath: getXPath(node.element),
            cssSelector: getCssSelector(node.element),
            visible: isVisible(node.element),
            url: this.url
          }
        });
      } else if (content.trim().length > 0 && content.trim().length < minContentLength) {
        // Log when we skip a heading chunk due to insufficient content
        logger.log(`[DomChunker] Skipping heading chunk "${headingPath.join(' > ')}" - insufficient content (${content.trim().length} chars, need ${minContentLength})`);
      }

      // Process children
      node.children.forEach(child => processNode(child, headingPath));
    };

    headingTree.forEach(node => processNode(node));
    return chunks;
  }

  /**
   * Walk siblings of startEl forward, collecting their text until we hit
   * stopEl, another heading, or run out. Used by extractContentUnderHeading.
   */
  private walkSiblingsForContent(
    startEl: HTMLElement,
    stopEl: HTMLElement | null
  ): string {
    const parts: string[] = [];
    let current = startEl.nextElementSibling;

    while (current && current !== stopEl) {
      if (current.tagName.match(/^H[1-6]$/)) break;
      if (current.tagName === 'IFRAME' || (current as HTMLElement).closest?.('iframe')) {
        current = current.nextElementSibling;
        continue;
      }

      let text: string | null = null;
      if (current.tagName === 'TABLE') {
        text = this.extractTableText(current as HTMLElement);
      } else if (current.textContent?.trim()) {
        text = extractTextContent(current as HTMLElement);
      }
      if (text) parts.push(text);

      current = current.nextElementSibling;
    }

    return parts.join(' ');
  }

  /**
   * Extract content under a heading until next heading.
   *
   * Primary strategy: walk siblings of the heading.
   * Fallback (for card/wrapper layouts like
   *   `<div><h3>Title</h3></div><div class="body"><p>Content</p></div>`):
   * if the primary walk finds nothing, climb to the heading's parent and walk
   * ITS siblings — the content is in a sibling container, not a sibling node.
   */
  private extractContentUnderHeading(
    heading: HTMLElement,
    nextHeading: HTMLElement | null
  ): string {
    let content = this.walkSiblingsForContent(heading, nextHeading);

    if (!content.trim()) {
      const parent = heading.parentElement;
      if (parent && parent !== heading.ownerDocument?.body) {
        content = this.walkSiblingsForContent(parent, nextHeading);
      }
    }

    return removeLinks(content.trim());
  }

  /**
   * Get content element for markdown conversion
   */
  private getContentElement(
    heading: HTMLElement,
    nextHeading: HTMLElement | null,
    mainContent: HTMLElement
  ): HTMLElement | null {
    // Create a container to hold all content under this heading
    const container = document.createElement('div');
    let current = heading.nextElementSibling;

    while (current && current !== nextHeading) {
      if (current.tagName.match(/^H[1-6]$/)) {
        break;
      }
      // Skip iframes and their content
      if (current.tagName === 'IFRAME') {
        current = current.nextElementSibling;
        continue;
      }
      // Skip elements inside iframes
      if ((current as HTMLElement).closest && (current as HTMLElement).closest('iframe')) {
        current = current.nextElementSibling;
        continue;
      }
      // Clone element to container
      container.appendChild(current.cloneNode(true));
      current = current.nextElementSibling;
    }

    return container.children.length > 0 ? container : null;
  }

  /**
   * Extract table as structured text
   */
  private extractTableText(table: HTMLElement): string {
    const rows: string[] = [];
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody') || table;
    
    // Process header
    if (thead) {
      const headerCells = Array.from(thead.querySelectorAll('tr:first-child th, tr:first-child td'));
      if (headerCells.length > 0) {
        const headers = headerCells.map(cell => extractTextContent(cell as HTMLElement).trim());
        rows.push(headers.join(' | '));
      }
    }
    
    // Process body rows
    const bodyRows = Array.from(tbody.querySelectorAll('tr'));
    bodyRows.forEach(row => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      if (cells.length > 0) {
        const cellTexts = cells.map(cell => extractTextContent(cell as HTMLElement).trim());
        rows.push(cellTexts.join(' | '));
      }
    });
    
    return rows.length > 0 ? `Table:\n${rows.join('\n')}` : '';
  }

  /**
   * Create chunks from content that doesn't fall under any heading
   * This captures content sections, paragraphs, and other elements that aren't associated with headings
   */
  private createChunksFromNonHeadingContent(
    mainContent: HTMLElement,
    headings: HTMLElement[]
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const headingSet = new Set(headings);
    
    // Build the "covered by heading chunks" set ONCE — O(N) — instead of
    // re-traversing every heading's sibling chain for every candidate (O(N²)).
    const covered = new Set<Element>();
    for (const heading of headings) {
      covered.add(heading);
      const next = findNextHeading(heading, mainContent);
      let cur = heading.nextElementSibling;
      while (cur && cur !== next) {
        covered.add(cur);
        cur.querySelectorAll('*').forEach(d => covered.add(d));
        cur = cur.nextElementSibling;
      }
    }

    // Get all potential content elements
    const allElements = Array.from(mainContent.querySelectorAll('*')) as HTMLElement[];
    const contentElements = allElements.filter(element => {
      if (!isVisible(element)) return false;
      if (element.closest('iframe')) return false;
      if (headingSet.has(element)) return false;
      if (covered.has(element)) return false;

      // Skip if any ancestor is covered (element is inside a heading chunk's tree)
      let parent = element.parentElement;
      while (parent && parent !== mainContent) {
        if (covered.has(parent)) return false;
        parent = parent.parentElement;
      }

      const text = extractTextContent(element);
      if (!text || text.trim().length < 50) return false;

      const tagName = element.tagName.toLowerCase();
      return (tagName === 'p' || tagName === 'section' || tagName === 'article' ||
              tagName === 'div' || tagName === 'main' || tagName === 'aside');
    });
    
    // Group nearby content elements into chunks
    let currentChunk: HTMLElement[] = [];
    let chunkIndex = 0;
    
    contentElements.forEach((element, index) => {
      // Check if this element is adjacent to previous elements in the chunk
      const isAdjacent = currentChunk.length === 0 || 
        (element.previousElementSibling === currentChunk[currentChunk.length - 1] ||
         element.previousElementSibling?.contains(currentChunk[currentChunk.length - 1]) ||
         currentChunk[currentChunk.length - 1].nextElementSibling === element ||
         currentChunk[currentChunk.length - 1].contains(element.nextElementSibling));
      
      if (isAdjacent && currentChunk.length < 5) {
        // Add to current chunk (max 5 elements per chunk)
        currentChunk.push(element);
      } else {
        // Finalize current chunk and start new one
        if (currentChunk.length > 0) {
          const chunkText = currentChunk.map(el => extractTextContent(el)).join(' ').trim();
          if (chunkText.length >= 50) {
            const container = document.createElement('div');
            currentChunk.forEach(el => container.appendChild(el.cloneNode(true)));
            const markdown = htmlToMarkdown(container);
            
            chunks.push({
              id: `content-${chunkIndex++}`,
              text: removeLinks(chunkText),
              metadata: {
                headingPath: [],
                semanticTag: 'content',
                headingLevel: 0,
                contentType: 'mixed',
                raw_text: removeLinks(chunkText),
                markdown: markdown,
                xpath: getXPath(currentChunk[0]),
                cssSelector: getCssSelector(currentChunk[0]),
                visible: true,
                url: this.url
              }
            });
          }
        }
        currentChunk = [element];
      }
    });
    
    // Finalize last chunk
    if (currentChunk.length > 0) {
      const chunkText = currentChunk.map(el => extractTextContent(el)).join(' ').trim();
      if (chunkText.length >= 50) {
        const container = document.createElement('div');
        currentChunk.forEach(el => container.appendChild(el.cloneNode(true)));
        const markdown = htmlToMarkdown(container);
        
        chunks.push({
          id: `content-${chunkIndex++}`,
          text: removeLinks(chunkText),
          metadata: {
            headingPath: [],
            semanticTag: 'content',
            headingLevel: 0,
            contentType: 'mixed',
            raw_text: removeLinks(chunkText),
            markdown: markdown,
            xpath: getXPath(currentChunk[0]),
            cssSelector: getCssSelector(currentChunk[0]),
            visible: true,
            url: this.url
          }
        });
      }
    }
    
    return chunks;
  }

  /**
   * Fallback: Create chunks from semantic tags
   */
  private createChunksFromSemanticTags(mainContent: HTMLElement): Chunk[] {
    const chunks: Chunk[] = [];
    // Exclude iframes and their content
    const allSections = mainContent.querySelectorAll('section, article, [role="region"]');
    const sections = Array.from(allSections).filter(section => {
      // Exclude sections inside iframes
      return !(section as HTMLElement).closest('iframe');
    }) as HTMLElement[];

    sections.forEach((section, index) => {
      if (!isVisible(section as HTMLElement)) return;

      const content = extractTextContent(section as HTMLElement);
      if (content) {
        const cleanContent = removeLinks(content);
        if (cleanContent) {
          // Convert to markdown
          const markdown = htmlToMarkdown(section as HTMLElement);
          
          chunks.push({
            id: `section-${index}`,
            text: cleanContent,
            metadata: {
              headingPath: [],
              semanticTag: section.tagName.toLowerCase(),
              headingLevel: 0,
              contentType: 'mixed',
              raw_text: cleanContent,
              markdown: markdown, // Add markdown version
              xpath: getXPath(section as HTMLElement),
              cssSelector: getCssSelector(section as HTMLElement),
              visible: isVisible(section as HTMLElement),
              url: this.url
            }
          });
        }
      }
    });

    return chunks;
  }

  /**
   * Deduplicate chunks based on text similarity
   */
  private deduplicateChunks(chunks: Chunk[]): Chunk[] {
    const seen = new Set<string>();
    const unique: Chunk[] = [];

    for (const chunk of chunks) {
      // Use raw_text as key for deduplication
      const key = chunk.metadata.raw_text.toLowerCase().trim();
      if (!seen.has(key) && key.length > 10) {
        seen.add(key);
        unique.push(chunk);
      }
    }

    return unique;
  }

  /**
   * Sanitize ID string
   */
  private sanitizeId(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

