/**
 * Core types for the RAG system
 */

export interface Chunk {
  id: string;
  text: string;
  metadata: {
    headingPath: string[];
    semanticTag: string;
    headingLevel: number;
    parentChunkId?: string;
    contentType: 'heading' | 'paragraph' | 'list' | 'mixed';
    context?: string;
    entity?: string;
    raw_text: string;
    markdown?: string; // Markdown version of content (Crawl4AI-style)
    xpath: string;
    cssSelector?: string;
    type?: 'card' | 'text' | 'mixed';
    widgetIndex?: number;
    elementIndex?: number;
    visible: boolean;
    url: string;
    // Filtering scores (added by contentFilter)
    qualityScore?: number;
    bm25Score?: number;
    totalScore?: number;
  };
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
  highlightElement?: HTMLElement;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  hybrid?: boolean;
}

export interface HeadingNode {
  element: HTMLElement;
  level: number;
  text: string;
  children: HeadingNode[];
  contentStart?: HTMLElement;
}

/** Single item in sidebar extra context (added via + button) */
export interface SidebarExtraContextItem {
  id: string;
  type: 'url' | 'text';
  value: string;
  title?: string;
}

export const SIDEBAR_EXTRA_CONTEXT_STORAGE_KEY = 'pagewise_sidebar_extra_context';

/** Single reference for the Define feature (word lookup) */
export interface WordReference {
  title: string;
  url: string;
  snippet?: string;
}

/** Response shape for references API */
export interface ReferencesResponse {
  word: string;
  references: WordReference[];
}

