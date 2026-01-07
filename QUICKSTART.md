# Quick Start Guide

## Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build the project**:
   ```bash
   npm run build
   ```

## Testing in Browser Console

### Option 1: Using test.html

1. Build the project: `npm run build`
2. Open `test/test.html` in your browser
3. Open browser console (F12)
4. The page will auto-initialize, or you can manually:
   ```javascript
   const rag = new PageRAG();
   await rag.init();
   const results = await rag.search("benefits");
   ```

### Option 2: Load bundle in any page

1. Build the project: `npm run build`
2. Open any webpage
3. In browser console, run:
   ```javascript
   // Load the bundle
   const script = document.createElement('script');
   script.src = 'http://localhost:8080/dist/test-bundle.js'; // Adjust path
   document.head.appendChild(script);
   
   // Wait for load, then use
   const rag = new PageRAG();
   await rag.init();
   await rag.search("your query");
   ```

## Chrome Extension Setup

1. **Build the extension**:
   ```bash
   npm run build
   ```

2. **Load in Chrome**:
   - Open Chrome
   - Go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `dist` folder

3. **Use the extension**:
   - Navigate to any webpage
   - Click the extension icon in toolbar
   - Enter your query
   - View results

## Troubleshooting

### Model Loading Issues

The embedding model (~20MB) downloads on first use. This may take a minute. Check browser console for progress.

### No Chunks Found

- Make sure the page has semantic HTML (headings, sections)
- Check browser console for errors
- Try a different webpage with better structure

### Extension Not Working

- Check `chrome://extensions/` for errors
- Open browser console on the webpage
- Check background service worker console

## Development

- **Watch mode**: `npm run dev` (rebuilds on file changes)
- **Production**: `npm run build`

## Next Steps

- Customize chunking logic in `src/core/DomChunker.ts`
- Adjust search parameters in `src/core/VectorStore.ts`
- Enhance UI in `src/extension/popup/`

