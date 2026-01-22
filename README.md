# PageWise - Chat with Any Page

A client-side RAG (Retrieval-Augmented Generation) system that enables you to query any webpage using semantic search. Works as a browser extension or standalone script.

## Features

- **Semantic HTML Parsing**: Uses heading hierarchy (h1-h6) for context-aware chunking
- **Client-Side Processing**: All processing happens in the browser, no backend required
- **Vector Search**: Powered by Orama with hybrid search (vector + keyword)
- **Browser Extension**: Chrome/Edge/Firefox extension for easy access
- **Console Testing**: Test in browser console before packaging as extension

## Project Structure

```
pagewise/
├── src/
│   ├── core/           # Core RAG components
│   ├── utils/          # Utility functions
│   ├── extension/      # Browser extension files
│   └── types/          # TypeScript types
├── test/               # Test files
├── public/            # Extension manifest and assets
└── dist/              # Built files (generated)
```

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build the project**:
   ```bash
   npm run build
   ```

3. **Test in browser console**:
   - Open `test/test.html` in your browser
   - Or load `dist/test-bundle.js` in any page
   - Use in console:
     ```javascript
     const rag = new PageRAG();
     await rag.init();
     const results = await rag.search("What are the benefits?");
     ```

## Chrome Extension

1. **Build the extension**:
   ```bash
   npm run build
   ```

2. **Load in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

3. **Use the extension**:
   - Click the extension icon
   - Enter your query
   - View results

## Development

- **Watch mode**: `npm run dev` - Rebuilds on file changes
- **Production build**: `npm run build`
- **Test server**: `npm run test:full-flow` - Opens full flow test page
- **Debug mode**: `npm run debug` - Build with source maps and open test page

### Debugging

For detailed debugging instructions, see [DEBUGGING_GUIDE.md](DEBUGGING_GUIDE.md).

**Quick Debug Setup:**
1. Run `npm run dev` in one terminal (watch mode)
2. Run `npm run test:full-flow` in another terminal
3. Open DevTools and set breakpoints in TypeScript files
4. Test changes without reloading extension

**Available Debug Functions:**
- `window.debugSearch(query)` - Test search directly
- `window.debugRAG()` - Inspect RAG state
- `window.debugMessages()` - View message history
- `window.enableDebugLogging()` - Enable debug logging

## Usage Examples

### Console Testing

```javascript
// Initialize
const rag = new PageRAG();
await rag.init();

// Search
const results = await rag.search("What are the benefits?", { limit: 5 });

// View results
results.forEach(result => {
  console.log(result.chunk.metadata.raw_text);
  rag.highlightResult(result);
});
```

### Extension Usage

1. Navigate to any webpage
2. Click the extension icon
3. Enter your query
4. View highlighted results

## Architecture

- **DomChunker**: Parses DOM using semantic HTML and heading hierarchy
- **EmbeddingService**: Generates embeddings using Transformers.js
- **VectorStore**: Stores and searches chunks using Orama
- **PageRAG**: Main orchestrator that ties everything together

## Dependencies

- `@orama/orama`: Vector search database
- `@xenova/transformers`: Client-side ML embeddings

## License

MIT

