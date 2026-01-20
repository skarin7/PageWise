/**
 * DOM Chunker - Semantic HTML parsing with heading-based chunking
 */

import type { Chunk, HeadingNode } from '../types';
import { getXPath, getCssSelector, isVisible, extractTextContent, removeLinks } from '../utils/domHelpers';
import { findMainContentByHeuristics } from '../utils/contentExtraction';
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
   * Main chunking method
   */
  async chunk(document: Document | HTMLElement): Promise<Chunk[]> {
    const root = document instanceof Document ? document.body : document;
    const chunks: Chunk[] = [];

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

    // Try common content containers
    const contentSelectors = [
      '[class*="content"]',
      '[class*="main"]',
      '[id*="content"]',
      '[id*="main"]',
      'article',
      'section[class*="content"]'
    ];
    
    for (const selector of contentSelectors) {
      const element = root.querySelector(selector);
      if (element && isVisible(element as HTMLElement)) {
        const textLength = (element.textContent || '').length;
        if (textLength > 100) {
          logger.log(`[DomChunker] Found main content via selector "${selector}":`, element.tagName);
          return element as HTMLElement;
        }
      }
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
   * Extract content under a heading until next heading
   */
  private extractContentUnderHeading(
    heading: HTMLElement,
    nextHeading: HTMLElement | null
  ): string {
    const content: string[] = [];
    let current = heading.nextElementSibling;

    while (current && current !== nextHeading) {
      if (current.tagName.match(/^H[1-6]$/)) {
        // Found nested heading, stop here
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

      if (current.tagName === 'P') {
        const text = extractTextContent(current as HTMLElement);
        if (text) content.push(text);
      } else if (current.tagName === 'UL' || current.tagName === 'OL') {
        // Handle lists - extract text from list
        const listText = extractTextContent(current as HTMLElement);
        if (listText) content.push(listText);
      } else if (current.tagName === 'TABLE') {
        // Special handling for tables
        const tableText = this.extractTableText(current as HTMLElement);
        if (tableText) content.push(tableText);
      } else if (current.textContent?.trim()) {
        const text = extractTextContent(current as HTMLElement);
        if (text) content.push(text);
      }

      current = current.nextElementSibling;
    }

    return removeLinks(content.join(' ').trim());
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
    
    // Find all substantial content elements (paragraphs, sections, articles, divs with content)
    const contentSelectors = [
      'p',
      'section:not(:has(h1, h2, h3, h4, h5, h6))',
      'article:not(:has(h1, h2, h3, h4, h5, h6))',
      'div[class*="content"]:not(:has(h1, h2, h3, h4, h5, h6))',
      'div[class*="text"]:not(:has(h1, h2, h3, h4, h5, h6))'
    ];
    
    // Get all potential content elements
    const allElements = Array.from(mainContent.querySelectorAll('*')) as HTMLElement[];
    const contentElements = allElements.filter(element => {
      // Skip if not visible
      if (!isVisible(element)) return false;
      
      // Skip if inside iframe
      if (element.closest('iframe')) return false;
      
      // Skip if it's a heading
      if (headingSet.has(element)) return false;
      
      // Skip if it's inside a heading's content area
      // (content under headings is already captured by heading-based chunking)
      for (const heading of headings) {
        const nextHeading = findNextHeading(heading, mainContent);
        let current = heading.nextElementSibling;
        while (current && current !== nextHeading) {
          if (current === element || current.contains(element)) {
            return false; // This element is already covered by a heading chunk
          }
          current = current.nextElementSibling;
        }
      }
      
      // Check if element has substantial text content
      const text = extractTextContent(element);
      if (!text || text.trim().length < 50) return false; // Minimum 50 chars
      
      // Prefer semantic elements or elements with substantial content
      const tagName = element.tagName.toLowerCase();
      if (tagName === 'p' || tagName === 'section' || tagName === 'article' || 
          tagName === 'div' || tagName === 'main' || tagName === 'aside') {
        return true;
      }
      
      return false;
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

