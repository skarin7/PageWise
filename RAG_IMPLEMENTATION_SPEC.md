# Project Specification: Phenom Career Site Client-Side RAG

## 1. Project Overview

### Goal
Build a "Chat with Page" feature that works on any website, enabling users to query page content and get scroll-to-highlight results, similar to Comet browser or AI-powered browser assistants. The solution will be deployed as a browser extension that works universally across websites.

### Core Function
The application will:
- Scrape the current DOM on page load
- Chunk content semantically using heading hierarchy and semantic HTML structure
- Create vector embeddings in the browser (client-side)
- Allow users to query the page content (e.g., "What are the benefits?")
- Provide scroll-to-highlight functionality for matched results
- Store vectors in IndexedDB for persistence across page reloads

### Use Cases
- "What are the benefits offered?"
- "Tell me about the company culture"
- "What positions are available in engineering?"
- "Show me testimonials from employees"

---

## 2. Technical Architecture

### Type
**Client-Side Ephemeral RAG** - No backend database, all processing happens in the browser.

### Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Runtime** | Browser (JavaScript/TypeScript) | Native browser APIs |
| **DOM Parsing** | Native DOMParser / DOM APIs | No external dependencies needed |
| **Vector Store** | Orama (formerly Lyra) | Optimized for client-side search, supports hybrid search |
| **Embeddings** | Transformers.js (Xenova/all-MiniLM-L6-v2) | Runs via WASM/WebGPU, ~20MB model |
| **Frontend Framework** | React (presumed) or Vanilla JS widget | Flexible integration |
| **Worker** | Web Worker | Offload heavy processing (embedding generation) |

### Architecture Flow

```
Page Load → DOM Scraping → Semantic HTML Chunking (Heading-Based) → Embedding Generation → Vector Store (IndexedDB) → Query Interface
                                                                                                                                    ↓
                                                                                    User Query → Semantic Search → Highlight & Scroll
```

### 2.1. Browser Extension Architecture (Target Deployment)

**Goal**: Deploy as a browser plugin/extension that works on any webpage.

**Architecture Components**:

1. **Content Script** (`content-script.js`)
   - Runs on page load, parses DOM, creates chunks
   - Communicates with background worker for embedding generation
   - Handles page navigation detection (SPA support)

2. **Background Service Worker** (`background.js`)
   - Manages extension lifecycle
   - Coordinates between content script and embedding worker
   - Handles storage operations

3. **Web Worker** (`worker.js`)
   - Handles embedding generation (Transformers.js)
   - Prevents UI blocking during model loading and processing
   - Processes chunks in batches

4. **Storage**: IndexedDB via Orama
   - Orama persists vectors to IndexedDB using its persistence API
   - Separate Orama database instances per URL/domain
   - Database name based on URL hash or domain
   - Automatic cleanup of old databases on navigation or storage limit

5. **UI Components**
   - Extension popup or sidebar for query interface
   - Options page for settings and data management

**Extension Structure**:
```
extension/
├── manifest.json (Chrome/Edge/Firefox)
├── content-script.js (DOM parsing, chunking)
├── background.js (Service worker)
├── worker.js (Web Worker for embeddings)
├── popup.html/js (Query UI)
└── options.html/js (Settings, clear data)
```

**Key Considerations**:
- **Permissions**: Need access to page DOM, storage, and potentially cross-origin (if needed)
- **Performance**: Parse and embed in background, show loading state
- **Storage Strategy**: Store chunks per URL, allow clearing old data
- **SPA Handling**: Use MutationObserver or navigation events to detect page changes
- **Memory Management**: Limit chunks per page, clear on navigation
- **Cross-Origin**: Handle CORS if needed for embedding API calls

---

## 3. Data Strategy: Semantic HTML Chunking

### Problem Statement
Standard text splitters break semantic context. Websites use semantic HTML structures (headings, sections, articles) to organize content hierarchically. Breaking this hierarchy loses important context (e.g., which section a benefit belongs to, the relationship between headings and content).

Relying on site-specific class names or data attributes (like `phw-widget`, `data-component`) is not scalable and won't work across different websites. Tools like Comet browser, Firecrawl, and Readability.js work universally by using semantic HTML standards.

### Solution
Use **Semantic HTML Chunking** based on:
1. **Heading hierarchy** (h1 → h2 → h3) - PRIMARY METHOD
2. **Semantic HTML tags** (`<article>`, `<section>`, `<main>`, `<nav>`, `<aside>`)
3. **ARIA landmarks** (`role="main"`, `role="navigation"`, etc.)
4. **Content extraction heuristics** (Readability-style text/link density analysis)

### 3.1. Parsing Logic (The "Algorithm")

The chunker follows this hierarchy (heading-based primary):

#### Step 1: Identify Main Content Area
- Find `<main>` tag or `role="main"` element
- Use Readability-style heuristics (text density, link density) if semantic tags not found
- Exclude `<nav>`, `<footer>`, `<aside>` (unless marked as content)
- Filter out hidden elements (`display: none`, `visibility: hidden`)

#### Step 2: Build Heading Hierarchy (PRIMARY METHOD)
- Extract all h1-h6 elements in document order from main content area
- Create tree structure: h1 → h2 → h3 → h4 → h5 → h6
- Track heading path: `["H1 Title", "H2 Section", "H3 Subsection"]`
- Each heading becomes a chunk boundary
- Maintain parent-child relationships

#### Step 3: Group Content Under Headings
- For each heading, collect all content until next same-level or higher heading
- Include: paragraphs (`<p>`), lists (`<ul>`, `<ol>`), nested headings (as children)
- Preserve hierarchical context: `[H1: Main Title] [H2: Section] [H3: Subsection] Content`
- Lists (`<ul>`, `<ol>`) = separate chunks per item (with heading context)
- Extract text content while preserving structure

#### Step 4: Extract Text Content
- Follow heading hierarchy: h1 → h2 → h3 → content
- Preserve full context path in chunk text
- Handle nested structures maintaining parent-child relationships
- Remove script, style, navigation links, and non-content elements
- Clean text: remove common link phrases ("View More", "Learn More", etc.)

#### Step 5: Fallback Strategy (if no headings found)
- Use semantic tags (`<section>`, `<article>`) as chunk boundaries
- Fall back to ARIA landmarks (`role="region"`, `role="article"`)
- Last resort: Use content heuristics (text density analysis)

### 3.2. Semantic HTML Attributes & Tags

| Element/Tag | Purpose | Usage |
|-------------|---------|-------|
| `<main>` | Main content area | Primary content container |
| `<article>` | Independent content | Article/blog post sections |
| `<section>` | Thematic grouping | Content sections |
| `<nav>` | Navigation | Exclude from chunking |
| `<aside>` | Sidebar content | Exclude unless marked as content |
| `<footer>` | Footer content | Exclude from chunking |
| `h1-h6` | Heading hierarchy | Primary chunk boundaries |
| `role="main"` | ARIA main landmark | Fallback for `<main>` |
| `role="navigation"` | ARIA nav landmark | Exclude from chunking |
| `role="region"` | ARIA region | Potential chunk boundary |
| `data-rag-ignore` | Manual exclusion | Skip element and children |

### 3.3. Fallback Strategy Layers

The chunker uses multiple fallback layers (in priority order):

1. **Semantic HTML + Heading Hierarchy** (primary)
   - Use heading hierarchy (h1-h6) to build content tree
   - Group content under headings
   - Use semantic tags (`<article>`, `<section>`) as boundaries

2. **ARIA Landmarks** (fallback layer 1)
   - `role="main"` for main content
   - `role="region"` for sections
   - `role="article"` for articles

3. **Content Heuristics** (fallback layer 2)
   - Text density analysis (Readability-style)
   - Link density analysis (high link density = navigation, exclude)
   - Identify main content area by text-to-link ratio

4. **Visual Analysis** (future enhancement)
   - Layout-based content detection
   - Requires vision model integration

5. **Site-Specific Optimizations** (optional)
   - Phenom widgets as optimization layer (can enhance chunking quality for Phenom sites)
   - Can be enabled per-domain for better results on known sites

---

## 4. Data Structures

### 4.1. The Chunk Object

Every item in the vector store must adhere to this interface:

```typescript
interface Chunk {
  id: string;              // Unique ID (e.g., "heading-0-h2-1-content")
  text: string;            // The semantic text for embedding
                           // Format: "[H1: Main Title] [H2: Section] [H3: Subsection] Content..."
  metadata: {
    headingPath: string[]; // ["Main Title", "Section", "Subsection"] - Full heading hierarchy
    semanticTag: string;   // "article", "section", "h2", "p", etc. - Semantic HTML tag
    headingLevel: number;  // 1-6 for h1-h6, 0 if no heading
    parentChunkId?: string; // For hierarchical relationships (parent chunk ID)
    contentType: 'heading' | 'paragraph' | 'list' | 'mixed'; // Type of content
    context?: string;      // Legacy: Section context (for backward compatibility)
    entity?: string;       // Legacy: Entity name (for backward compatibility)
    raw_text: string;      // Original text without semantic prefixes
    xpath: string;         // For scroll-to-highlight (e.g., "/html/body/div[2]/div[3]")
    cssSelector?: string;  // Alternative selector (more reliable than xpath)
    type?: 'card' | 'text' | 'mixed'; // Legacy type (may merge with contentType)
    widgetIndex?: number;   // Legacy: Index of parent widget (deprecated, use parentChunkId)
    elementIndex?: number;  // Index within parent (for lists, etc.)
    visible: boolean;      // Whether element is currently visible
    url: string;          // URL of the page (for browser extension)
  }
}
```

### 4.2. Search Result Object

```typescript
interface SearchResult {
  chunk: Chunk;
  score: number;           // Similarity score (0-1)
  highlightElement?: HTMLElement; // DOM element to highlight
}
```

---

## 5. Implementation Roadmap

### Phase 1: The Chunker (Extraction)

**Goal**: Create a TypeScript class `DomChunker` that implements semantic HTML parsing with heading-based chunking.

**Requirements**:
- Input: `document.body` or a DOM element
- Output: Array of `Chunk` objects
- Primary method: Heading hierarchy-based chunking
- Fallback methods: Semantic tags, ARIA landmarks, content heuristics
- Must implement `getXPath(element: HTMLElement): string` helper
- Must implement `getCssSelector(element: HTMLElement): string` helper (more reliable)
- Handle visibility filtering (ignore hidden elements)
- De-duplicate content (mobile/desktop variants, duplicate text)
- Filter out navigation links and non-content elements

**Key Methods**:
```typescript
class DomChunker {
  chunk(document: Document | HTMLElement): Chunk[]
  private findMainContent(root: HTMLElement): HTMLElement
  private buildHeadingHierarchy(mainContent: HTMLElement): HeadingNode[]
  private createChunksFromHeadings(headingTree: HeadingNode[], mainContent: HTMLElement): Chunk[]
  private extractContentUnderHeading(heading: HTMLElement, nextHeading: HTMLElement | null): string
  private getHeadingPath(heading: HTMLElement): string[]
  private getXPath(element: HTMLElement): string
  private getCssSelector(element: HTMLElement): string
  private isVisible(element: HTMLElement): boolean
  private deduplicateChunks(chunks: Chunk[]): Chunk[]
  private removeNavigationLinks(text: string): string
  private extractTextContent(element: HTMLElement): string
}

interface HeadingNode {
  element: HTMLElement;
  level: number; // 1-6
  text: string;
  children: HeadingNode[];
  contentStart: HTMLElement; // First content element after heading
}
```

### Phase 2: The Vector Store (Orama)

**Goal**: Create a `VectorStore` class using `@orama/orama` for hybrid search.

**Requirements**:
- Initialize Orama with schema matching `Chunk` interface
- Support both vector similarity search and keyword search (hybrid)
- Efficient insertion of chunks
- Fast query performance

**Key Methods**:
```typescript
class VectorStore {
  private db: Orama;
  
  async init(): Promise<void>
  async insertChunks(chunks: Chunk[]): Promise<void>
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]>
  async clear(): Promise<void>
}
```

**Orama Schema**:
```typescript
const schema = {
  id: 'string',
  text: 'string',
  headingPath: 'string[]',      // NEW: Array of heading path
  semanticTag: 'string',         // NEW: Semantic HTML tag
  headingLevel: 'number',       // NEW: Heading level (1-6)
  parentChunkId: 'string',       // NEW: Parent chunk reference
  contentType: 'string',        // NEW: Content type
  context: 'string',            // Existing (for backward compatibility)
  entity: 'string',            // Existing (for backward compatibility)
  raw_text: 'string',          // Existing
  xpath: 'string',             // Existing
  cssSelector: 'string',       // Existing
  type: 'string',              // Existing (legacy, may merge with contentType)
  widgetIndex: 'number',       // Existing (legacy, deprecated)
  elementIndex: 'number',      // Existing
  visible: 'boolean',         // Existing
  url: 'string',              // NEW: URL for browser extension
} as const;
```

**Orama + IndexedDB Integration** (Browser Extension):
- Orama can persist to IndexedDB using its persistence API (`persist` plugin)
- Create separate Orama database instances per URL/domain
- Database naming: `orama-${urlHash}` or `orama-${domain}`
- Store database metadata (URL, timestamp, chunk count) for cleanup
- Clear old databases on navigation or when storage limit reached
- Load existing database on page revisit (if URL matches)

**Example Orama Initialization with Persistence**:
```typescript
import { create, insert } from '@orama/orama';
import { persist } from '@orama/plugin-data-persistence';

const db = await create({
  schema,
  plugins: [persist]
});

// Persist to IndexedDB
await persist(db, 'indexeddb', `orama-${urlHash}`);

// Load from IndexedDB
const loadedDb = await restore('indexeddb', `orama-${urlHash}`);
```

### Phase 3: The Embedder (Transformers.js)

**Goal**: Create an `EmbeddingService` using `@xenova/transformers` for generating embeddings.

**Requirements**:
- Load `all-MiniLM-L6-v2` model as singleton
- Run in Web Worker to avoid UI blocking
- Batch processing for multiple texts
- Error handling for model loading failures

**Key Methods**:
```typescript
class EmbeddingService {
  private pipeline: FeatureExtractionPipeline | null = null;
  private worker: Worker | null = null;
  
  async init(): Promise<void>
  async embed(text: string): Promise<number[]>
  async embedBatch(texts: string[]): Promise<number[][]>
  private loadModel(): Promise<void>
}
```

**Performance Considerations**:
- Model size: ~20MB (download once, cache in IndexedDB)
- Processing: ~50-100ms per text (batch for efficiency)
- Use Web Worker to prevent UI freezing

### Phase 4: Integration (The "Chat" Loop)

**Goal**: Create a main controller that orchestrates all components.

**Requirements**:
- Initialize all services on page load
- Handle async operations gracefully
- Provide search interface
- Implement scroll-to-highlight functionality
- Error handling and loading states

**Key Methods**:
```typescript
class PageRAG {
  private chunker: DomChunker;
  private embedder: EmbeddingService;
  private vectorStore: VectorStore;
  
  async init(): Promise<void>
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]>
  highlightResult(result: SearchResult): void
  scrollToResult(result: SearchResult): void
  private processPage(): Promise<void>
}
```

**Initialization Flow**:
1. Wait for DOM ready
2. Initialize EmbeddingService (load model)
3. Initialize VectorStore
4. Run DomChunker on document
5. Generate embeddings for all chunks (batched)
6. Insert chunks into VectorStore
7. Ready for queries

---

## 6. Example Parsing Logic (Reference Code)

```typescript
// Reference implementation for Semantic HTML Chunker
function extractChunks(document: Document): Chunk[] {
  const chunks: Chunk[] = [];
  
  // Step 1: Find main content area
  const mainContent = findMainContent(document);
  if (!mainContent) return chunks;
  
  // Step 2: Build heading hierarchy
  const headings = mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6');
  
  if (headings.length > 0) {
    // PRIMARY: Heading-based chunking
    const headingTree = buildHeadingHierarchy(Array.from(headings) as HTMLElement[]);
    chunks.push(...createChunksFromHeadingTree(headingTree, mainContent));
  } else {
    // FALLBACK: Use semantic tags
    const sections = mainContent.querySelectorAll('section, article, [role="region"]');
    if (sections.length > 0) {
      sections.forEach((section, index) => {
        const content = extractTextContent(section as HTMLElement);
        if (content) {
          chunks.push(createChunkFromElement(section as HTMLElement, content, []));
        }
      });
    }
  }
  
  return deduplicateChunks(chunks);
}

// Find main content area using semantic HTML and heuristics
function findMainContent(document: Document): HTMLElement | null {
  // Try semantic HTML first
  const main = document.querySelector('main') || 
              document.querySelector('[role="main"]');
  if (main) return main as HTMLElement;
  
  // Fallback: Use heuristics (Readability-style)
  return findMainContentByHeuristics(document);
}

// Build heading hierarchy tree
function buildHeadingHierarchy(headings: HTMLElement[]): HeadingNode[] {
  const tree: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  
  headings.forEach(heading => {
    const level = parseInt(heading.tagName.charAt(1));
    const text = heading.textContent?.trim() || '';
    const node: HeadingNode = {
      element: heading,
      level,
      text,
      children: [],
      contentStart: heading.nextElementSibling as HTMLElement
    };
    
    // Find parent in stack
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    
    if (stack.length === 0) {
      tree.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    
    stack.push(node);
  });
  
  return tree;
}

// Create chunks from heading tree
function createChunksFromHeadingTree(
  headingTree: HeadingNode[], 
  mainContent: HTMLElement
): Chunk[] {
  const chunks: Chunk[] = [];
  
  function processNode(node: HeadingNode, parentPath: string[] = []) {
    const headingPath = [...parentPath, node.text];
    const nextHeading = findNextHeading(node.element, mainContent);
    const content = extractContentUnderHeading(node.element, nextHeading);
    
    if (content.trim()) {
      const semanticText = headingPath.map((h, i) => `[H${i + 1}: ${h}]`).join(' ') + ` ${content}`;
      
      chunks.push({
        id: `heading-${node.level}-${headingPath.join('-')}`,
        text: semanticText,
        metadata: {
          headingPath,
          semanticTag: node.element.tagName.toLowerCase(),
          headingLevel: node.level,
          parentChunkId: parentPath.length > 0 ? `heading-${parentPath.join('-')}` : undefined,
          contentType: 'mixed',
          raw_text: content,
          xpath: getXPath(node.element),
          cssSelector: getCssSelector(node.element),
          visible: isVisible(node.element),
          url: window.location.href
        }
      });
    }
    
    // Process children
    node.children.forEach(child => processNode(child, headingPath));
  }
  
  headingTree.forEach(node => processNode(node));
  return chunks;
}

// Extract content under a heading until next heading
function extractContentUnderHeading(
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
      // Handle lists - each item becomes separate chunk in full implementation
      const listText = extractTextContent(current as HTMLElement);
      if (listText) content.push(listText);
    } else if (current.textContent?.trim()) {
      const text = extractTextContent(current as HTMLElement);
      if (text) content.push(text);
    }
    
    current = current.nextElementSibling;
  }
  
  return content.join(' ').trim();
}

// Find next heading at same or higher level
function findNextHeading(heading: HTMLElement, container: HTMLElement): HTMLElement | null {
  const level = parseInt(heading.tagName.charAt(1));
  let current = heading.nextElementSibling;
  
  while (current && container.contains(current)) {
    if (current.tagName.match(/^H[1-6]$/)) {
      const nextLevel = parseInt(current.tagName.charAt(1));
      if (nextLevel <= level) {
        return current as HTMLElement;
      }
    }
    current = current.nextElementSibling;
  }
  
  return null;
}

// Helper: Extract text content, ignoring script/style/nav elements
function extractTextContent(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  
  // Remove unwanted elements
  clone.querySelectorAll('script, style, nav, [data-rag-ignore], a[href*="#"]').forEach(el => el.remove());
  
  return clone.textContent?.trim() || '';
}

// Helper: Remove link text and navigation elements
function removeLinks(text: string): string {
  // Remove common link phrases
  return text.replace(/\b(View More|Learn More|Read More|See More|Read more|Learn more)\b/gi, '').trim();
}

// Helper: Find main content using heuristics (Readability-style)
function findMainContentByHeuristics(document: Document): HTMLElement | null {
  // Simplified heuristic: find element with highest text density
  const candidates = Array.from(document.querySelectorAll('body > *')) as HTMLElement[];
  let bestCandidate: HTMLElement | null = null;
  let maxScore = 0;
  
  candidates.forEach(candidate => {
    if (candidate.tagName === 'NAV' || candidate.tagName === 'FOOTER' || 
        candidate.tagName === 'HEADER' || candidate.tagName === 'ASIDE') {
      return; // Skip navigation elements
    }
    
    const text = candidate.textContent || '';
    const links = candidate.querySelectorAll('a').length;
    const textLength = text.length;
    const linkLength = Array.from(candidate.querySelectorAll('a'))
      .reduce((sum, a) => sum + (a.textContent?.length || 0), 0);
    
    // Text density score (simplified)
    const score = textLength > 0 ? (textLength - linkLength * 2) / textLength : 0;
    
    if (score > maxScore && textLength > 200) {
      maxScore = score;
      bestCandidate = candidate;
    }
  });
  
  return bestCandidate;
}
```

---

## 7. Known Edge Cases & Constraints

### 7.1. Content Filtering

**"View More" Links**
- Ignore any text inside `<a>` tags or elements with `data-component="widget-link"`
- Remove phrases like "View More", "Learn More", "Read More" from chunk text

**Navigation Elements**
- Skip header, footer, and navigation menus
- Consider adding a `data-rag-ignore` attribute for manual exclusions

### 7.2. Responsive Duplicates

**Hidden Mobile/Desktop Duplicates**
- The DOM often contains duplicate text for mobile vs desktop views
- Classes: `phw-d-mob-none` (hidden on mobile), `phw-d-desk-none` (hidden on desktop)
- **Solution**: 
  - Check `window.getComputedStyle(element).display !== 'none'`
  - De-duplicate based on text similarity (use Levenshtein distance or simple text matching)
  - Prefer visible version over hidden version

### 7.3. Dynamic Content

**Lazy-Loaded Content**
- Some content may load after initial page render (lazy loading, infinite scroll)
- **Solution**: Use `MutationObserver` to detect new content and re-chunk
- Monitor main content area for new headings or sections

**SPA Navigation**
- If the site is a Single Page Application, re-chunk on route changes
- **Solution**: 
  - Hook into router events (if detectable)
  - Use `MutationObserver` on main content area
  - Detect URL changes via `popstate` and `pushstate` events
  - Clear old chunks and re-process page on navigation

### 7.4. Performance Considerations

**Model Loading**
- Transformers.js requires loading ~20MB of model weights
- **Solution**: 
  - Load in Web Worker to avoid freezing UI
  - Cache model in IndexedDB after first load
  - Show loading indicator during initialization

**Embedding Generation**
- Processing time: ~50-100ms per text chunk
- **Solution**:
  - Batch process chunks (e.g., 10 at a time)
  - Show progress indicator
  - Use `requestIdleCallback` for non-critical processing

**Memory Management**
- Large pages may generate hundreds of chunks
- **Solution**:
  - Limit chunk size (max 512 tokens)
  - Consider pagination for very long pages
  - Clear old chunks when navigating

### 7.5. XPath Reliability

**Problem**: XPath can break when DOM changes dynamically.

**Solution**: 
- Prefer CSS selectors over XPath (more stable)
- Use unique IDs or data attributes when available
- Fallback to XPath if CSS selector not available
- Re-query element before scrolling (in case DOM changed)

### 7.6. Search Quality

**Hybrid Search**
- Use Orama's hybrid search (vector + keyword) for better results
- Tune similarity threshold (default: 0.7)
- Consider re-ranking results based on:
  - Heading level (h1 > h2 > h3) - higher level headings are more important
  - Position in document (above-fold content prioritized)
  - Heading path depth (shorter paths = more general, longer paths = more specific)

**Query Understanding**
- Handle common queries like "benefits", "what are the benefits", "show me benefits"
- Consider query expansion or normalization

---

## 8. Additional Considerations

### 8.1. Error Handling

- Model loading failures → Fallback to keyword-only search
- DOM parsing errors → Log and continue with other widgets
- Embedding generation errors → Skip problematic chunks
- Search errors → Return empty results with error message

### 8.2. User Experience

**Loading States**:
- Show initialization progress (0% → 100%)
- Indicate when ready for queries
- Show search progress for long queries

**Highlighting**:
- Smooth scroll to result
- Visual highlight (border, background color)
- Dismiss highlight after 3 seconds or on next search
- Support multiple results (show all, allow navigation)

**Query Interface**:
- Auto-complete suggestions (optional)
- Query history (localStorage)
- Clear button
- Keyboard shortcuts (Enter to search, Esc to clear)

### 8.3. Testing Strategy

**Unit Tests**:
- Chunker: Test widget detection, context extraction, chunk creation
- Embedder: Test model loading, embedding generation
- VectorStore: Test insertion, search, retrieval

**Integration Tests**:
- End-to-end: Page load → chunk → embed → search → highlight
- Test with various widget types
- Test edge cases (hidden elements, duplicates, etc.)

**Performance Tests**:
- Measure initialization time
- Measure search latency
- Test with large pages (100+ widgets)

### 8.4. Future Enhancements

- **Visual/Layout Analysis**: 
  - Use vision-language models (VLMs) to understand page layout
  - Detect content regions based on visual structure
  - Handle pages with poor semantic HTML
  - Reference: WebSight, vision-based web agents
  - Requires: Vision model integration (e.g., GPT-4V, Claude with vision)

- **Multi-language support**: Detect language and use appropriate embedding model

- **Caching**: Cache embeddings for static content (same URL, same content hash)

- **Analytics**: Track popular queries, search success rate, chunk quality metrics

- **A/B Testing**: Test different chunking strategies (heading-based vs section-based)

- **Export/Import**: Allow exporting page context for offline use

- **Cross-page Context**: Maintain context across multiple pages in same domain

---

## 9. Optional: Site-Specific Optimizations

### 9.1. Phenom Widget Optimizations (Optional Layer)

For enhanced chunking quality on Phenom career sites, an optional optimization layer can be enabled that recognizes Phenom-specific CMS attributes:

**Phenom Widget Attributes**:
- `class="phw-widget"` - Widget container
- `data-component="widget-title"` - Widget header
- `role="listitem"` - Card/list items
- `data-component="card-title"` - Card title
- `data-component="card-description"` - Card description
- `text-element="text"` - Text content marker

**Implementation**:
- Can be enabled per-domain via extension settings
- Runs as additional pass after semantic HTML chunking
- Enhances chunks with Phenom-specific metadata
- Falls back to semantic HTML chunking if Phenom attributes not found

**Note**: This is an optional optimization. The core system works without it using semantic HTML parsing.

### 9.2. Other Site-Specific Optimizations

The architecture supports adding domain-specific optimizations:
- Custom chunking rules per domain
- Domain-specific content extraction heuristics
- Custom metadata extraction
- All optimizations are optional and fall back to semantic HTML parsing

---

## 10. Dependencies

```json
{
  "dependencies": {
    "@orama/orama": "^1.x.x",
    "@xenova/transformers": "^2.x.x"
  },
  "devDependencies": {
    "typescript": "^5.x.x",
    "@types/node": "^20.x.x"
  }
}
```

---

## 11. References & Open-Source Tools

### Key Tools & Techniques

1. **Mozilla Readability.js**
   - Main content extraction algorithm
   - Text density and link density heuristics
   - Reference: https://github.com/mozilla/readability

2. **Firecrawl**
   - Converts DOM to clean Markdown preserving structure
   - API-first crawler for LLM workflows
   - Reference: https://firecrawl.dev

3. **Crawl4AI**
   - HTML simplification with semantic preservation
   - Clean Markdown generation
   - Reference: https://github.com/bogpad/crawl4ai

4. **AutoWebGLM**
   - HTML simplification algorithm for LLM consumption
   - Research paper: https://arxiv.org/abs/2404.03648

5. **Dripper**
   - Semantic block sequence classification
   - Lightweight content extraction
   - Research paper: https://arxiv.org/abs/2511.23119

6. **WebSight**
   - Vision-based web understanding (advanced)
   - Visual perception for web agents
   - Research paper: https://arxiv.org/abs/2508.16987

### Related Research Papers

- **SCRIBES**: Reinforcement learning for extraction scripts (https://arxiv.org/abs/2510.01832)
- **BrowserAgent**: Human-inspired web browsing actions (https://arxiv.org/abs/2510.10666)
- **LiteWebAgent**: Vision-language model-based web agents (https://arxiv.org/abs/2503.02950)

### Standards & Specifications

- **HTML5 Semantic Elements**: https://developer.mozilla.org/en-US/docs/Web/HTML/Element
- **ARIA Landmarks**: https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/
- **Orama Documentation**: https://docs.orama.ml
- **Transformers.js**: https://huggingface.co/docs/transformers.js

---

## 12. Implementation Plan

### 12.1. Project Structure

```
pagewise/
├── src/
│   ├── core/
│   │   ├── DomChunker.ts          # Semantic HTML chunking
│   │   ├── EmbeddingService.ts     # Transformers.js embeddings
│   │   ├── VectorStore.ts          # Orama + IndexedDB
│   │   └── PageRAG.ts              # Main orchestrator
│   ├── utils/
│   │   ├── domHelpers.ts           # XPath, CSS selectors, visibility
│   │   ├── contentExtraction.ts    # Readability-style heuristics
│   │   └── headingHierarchy.ts     # Heading tree building
│   ├── extension/
│   │   ├── content-script.ts        # Content script entry
│   │   ├── background.ts            # Service worker
│   │   ├── worker.ts                # Web Worker for embeddings
│   │   ├── popup/
│   │   │   ├── popup.html
│   │   │   └── popup.ts
│   │   └── options/
│   │       ├── options.html
│   │       └── options.ts
│   └── types/
│       └── index.ts                 # TypeScript interfaces
├── public/
│   └── manifest.json                # Chrome extension manifest
├── test/
│   └── test.html                    # Console testing page
├── package.json
├── tsconfig.json
├── webpack.config.js                # Bundle for extension
└── README.md
```

### 12.2. Implementation Phases

**Phase 1: Project Setup**
- Initialize TypeScript project
- Install dependencies (@orama/orama, @xenova/transformers)
- Configure build system (webpack for extension)
- Set up TypeScript config

**Phase 2: Core Classes (Console-Testable)**
- **DomChunker**: Semantic HTML parsing with heading hierarchy
- **EmbeddingService**: Transformers.js integration with Web Worker
- **VectorStore**: Orama with IndexedDB persistence
- **PageRAG**: Main controller

**Phase 3: Console Testing**
- Create standalone test script
- Make classes importable in browser console
- Create test page (test.html) for manual testing
- Build as UMD bundle for script tag loading

**Phase 4: Chrome Extension**
- Create manifest.json (Manifest V3)
- Set up content script injection
- Create background service worker
- Build popup UI for queries
- Package extension

### 12.3. Dependencies

```json
{
  "dependencies": {
    "@orama/orama": "^1.0.0",
    "@xenova/transformers": "^2.17.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/chrome": "^0.0.254",
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.4",
    "ts-loader": "^9.5.1",
    "copy-webpack-plugin": "^11.0.0"
  }
}
```

### 12.4. Console Testing Approach

1. Build as UMD bundle that can be loaded via script tag
2. Create test.html page that loads the bundle
3. Expose global `PageRAG` class for console access
4. Example usage in console:
   ```javascript
   const rag = new PageRAG();
   await rag.init();
   const results = await rag.search("What are the benefits?");
   ```

### 12.5. Chrome Extension Structure

- **Manifest V3** (latest standard)
- Content script runs on all pages (or specific domains)
- Background service worker for coordination
- Web Worker for embeddings (off main thread)
- Popup for query interface
- Options page for settings

---

## 13. Getting Started

1. **Set up project** with TypeScript and dependencies
2. **Implement Phase 1** (DomChunker) with semantic HTML parsing and comprehensive tests
3. **Implement Phase 2** (VectorStore) with Orama integration and IndexedDB persistence
4. **Implement Phase 3** (EmbeddingService) with Web Worker
5. **Implement Phase 4** (Integration) with UI components
6. **Create browser extension** structure (manifest, content script, background worker)
7. **Test on various websites** to ensure scalability
8. **Add optional Phenom optimizations** for enhanced quality on Phenom sites
9. **Iterate based on search quality feedback**

---

**Document Version**: 2.0  
**Last Updated**: [Current Date]  
**Status**: Ready for Implementation  
**Deployment Target**: Browser Extension (Chrome/Edge/Firefox)
