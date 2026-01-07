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
        console.log('[DomChunker] Using body as main content (this is normal for some pages)');
      } else {
        console.warn('[DomChunker] No main content found, using body as fallback');
      }
      
      // Use body directly - this is fine, many pages don't have semantic main tags
      const bodyHeadings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[];
      const visibleBodyHeadings = bodyHeadings.filter(h => isVisible(h));
      
      if (visibleBodyHeadings.length > 0) {
        console.log(`[DomChunker] Found ${visibleBodyHeadings.length} headings in body, chunking by headings`);
        const headingTree = buildHeadingHierarchy(visibleBodyHeadings);
        chunks.push(...this.createChunksFromHeadingTree(headingTree, root));
      } else {
        // Last resort: chunk entire body by sections
        console.log('[DomChunker] No headings found, chunking body by semantic sections');
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
      console.log(`[DomChunker] Final chunks: ${processed.length}`);
      return processed;
    }

    console.log(`[DomChunker] Main content found: ${mainContent.tagName}${mainContent.id ? '#' + mainContent.id : ''}${mainContent.className ? '.' + mainContent.className.split(' ')[0] : ''}`);

    // Step 2: Build heading hierarchy
    const headings = Array.from(mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[];
    const visibleHeadings = headings.filter(h => isVisible(h));
    
    console.log(`[DomChunker] Found ${headings.length} total headings, ${visibleHeadings.length} visible`);

    if (visibleHeadings.length > 0) {
      // PRIMARY: Heading-based chunking
      const headingTree = buildHeadingHierarchy(visibleHeadings);
      chunks.push(...this.createChunksFromHeadingTree(headingTree, mainContent));
      console.log(`[DomChunker] Created ${chunks.length} chunks from heading tree`);
    } else {
      // FALLBACK: Use semantic tags
      console.log('[DomChunker] No visible headings, using semantic tags fallback');
      chunks.push(...this.createChunksFromSemanticTags(mainContent));
      console.log(`[DomChunker] Created ${chunks.length} chunks from semantic tags`);
    }

    // Step 1: Deduplicate
    let processed = this.deduplicateChunks(chunks);
    console.log(`[DomChunker] After deduplication: ${processed.length} chunks`);
    
    // Step 2: Remove boilerplate
    processed = removeBoilerplate(processed);
    console.log(`[DomChunker] After boilerplate removal: ${processed.length} chunks`);
    
    // Step 3: Filter by relevance (BM25 + quality scoring)
    processed = filterChunksByRelevance(processed, {
      minQualityScore: -5, // Allow some negative scores
      minBM25Score: 0,
      removeDuplicates: true
    });
    console.log(`[DomChunker] After relevance filtering: ${processed.length} chunks`);
    
    console.log(`[DomChunker] Final chunks: ${processed.length}`);
    return processed;
  }

  /**
   * Find main content area
   */
  private async findMainContent(root: HTMLElement): Promise<HTMLElement | null> {
    // Try semantic HTML first
    const main = root.querySelector('main') || root.querySelector('[role="main"]');
    if (main && isVisible(main as HTMLElement)) {
      console.log('[DomChunker] Found main content via semantic HTML:', main.tagName);
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
          console.log(`[DomChunker] Found main content via selector "${selector}":`, element.tagName);
          return element as HTMLElement;
        }
      }
    }

    // Try LLM-based extraction if enabled
    const config = this.llmConfig || await getLLMConfig();
    if (config.enabled) {
      try {
        const llmResult = await findMainContentByLLM(root.ownerDocument || document, config);
        if (llmResult) {
          console.log('[DomChunker] ✅ Found main content via LLM:', llmResult.tagName);
          return llmResult;
        }
      } catch (error) {
        console.warn('[DomChunker] LLM extraction failed, falling back to heuristics:', error);
      }
    }

    // Fallback: Use heuristics
    const heuristicResult = findMainContentByHeuristics(root.ownerDocument || document);
    if (heuristicResult) {
      console.log('[DomChunker] Found main content via heuristics:', heuristicResult.tagName);
    } else {
      console.warn('[DomChunker] Heuristics failed to find main content');
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

      if (content.trim()) {
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
   * Fallback: Create chunks from semantic tags
   */
  private createChunksFromSemanticTags(mainContent: HTMLElement): Chunk[] {
    const chunks: Chunk[] = [];
    const sections = mainContent.querySelectorAll('section, article, [role="region"]');

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

