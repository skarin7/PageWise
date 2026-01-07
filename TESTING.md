# Local Testing Guide

## Quick Start

### Option 1: Direct File Testing (Easiest)

1. **Build the project**:
   ```bash
   npm run build
   ```

2. **Open test page**:
   - Open `test/local-test.html` directly in your browser
   - Or use: `npm run test:server` (starts a local server)

3. **Test**:
   - Click "Initialize" button
   - Wait for initialization (first time may take 1-2 minutes for model download)
   - Enter a query and click "Search"
   - View results and chunks

### Option 2: Browser Console Testing

1. **Build the project**:
   ```bash
   npm run build
   ```

2. **Open any webpage** in Chrome

3. **Load the bundle** in console:
   ```javascript
   // Method 1: Load from file system (if using file://)
   const script = document.createElement('script');
   script.src = 'file:///absolute/path/to/dist/test-bundle.js';
   document.head.appendChild(script);
   
   // Method 2: Use a local server (recommended)
   // First run: npm run test:server
   // Then in console:
   const script = document.createElement('script');
   script.src = 'http://localhost:8080/dist/test-bundle.js';
   document.head.appendChild(script);
   ```

4. **Use in console**:
   ```javascript
   // Wait for script to load, then:
   const rag = new PageRAG();
   await rag.init();
   
   // Search
   const results = await rag.search("your query");
   console.log(results);
   
   // Highlight first result
   if (results[0]) {
     rag.highlightResult(results[0]);
   }
   ```

### Option 3: Local Development Server

1. **Start dev server**:
   ```bash
   npm run test:server
   ```
   This starts a server on `http://localhost:8080`

2. **Open in browser**:
   - Navigate to `http://localhost:8080/test/local-test.html`
   - Or it may open automatically

3. **Test with watch mode** (for development):
   ```bash
   # Terminal 1: Watch for changes
   npm run dev
   
   # Terminal 2: Start server
   npm run test:server
   ```

## Testing Workflow

### 1. Initial Testing
- Use `test/local-test.html` - it has test content built-in
- Good for testing core functionality

### 2. Real Website Testing
- Use browser console method
- Test on actual websites (news sites, blogs, etc.)
- Verify chunking works on different page structures

### 3. Extension Testing
- Only test extension after local testing passes
- Load unpacked extension in Chrome
- Test popup UI and content script integration

## Debugging Tips

### Check Console Output
- Open browser DevTools (F12)
- Check Console tab for errors
- Look for `[PageRAG]` prefixed logs

### Common Issues

1. **"PageRAG is not defined"**
   - Make sure `test-bundle.js` is loaded
   - Check browser console for script loading errors

2. **Model loading takes too long**
   - First load downloads ~20MB model
   - Check network tab for download progress
   - Subsequent loads are faster (cached)

3. **No chunks found**
   - Page might not have semantic HTML
   - Check if page has headings (h1-h6)
   - Try a different website

4. **Search returns no results**
   - Make sure initialization completed
   - Check chunk count in status
   - Try simpler queries

## Testing Checklist

- [ ] Build succeeds (`npm run build`)
- [ ] Test page loads without errors
- [ ] Initialization completes successfully
- [ ] Chunks are created (check chunk count)
- [ ] Search returns results
- [ ] Highlighting works (results scroll into view)
- [ ] Works on different websites
- [ ] Console shows helpful logs

## Before Packaging Extension

Make sure:
1. ✅ All local tests pass
2. ✅ Works on multiple websites
3. ✅ Error handling works
4. ✅ No console errors
5. ✅ Performance is acceptable

Then build for production:
```bash
npm run build
```

And load `dist/` folder as unpacked extension.

