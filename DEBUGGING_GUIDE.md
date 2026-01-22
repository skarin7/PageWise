# Debugging Guide for PageWise Extension

This guide explains how to debug and test the PageWise extension without rebuilding and reloading the extension for every change.

## Environment Detection

The plugin automatically differentiates between the **real browser extension environment** and the **test environment**:

### How It Works

1. **Chrome API Mocking** (`test/chrome-api-mock.js`):
   - **Test Environment**: If `chrome` is undefined or `chrome.runtime` doesn't exist, the mock replaces `window.chrome` with mocked APIs
   - **Real Extension**: If real Chrome APIs exist, the mock adds `window.chromeMock` but leaves the real `chrome` intact
   - The mock provides the same interface, so code using `chrome.runtime` works in both environments

2. **Automatic Detection**:
   - The content script doesn't need explicit checks - it just uses `chrome.runtime` 
   - In test: `chrome` is the mock (transparent replacement)
   - In extension: `chrome` is the real API

3. **Environment Utilities** (`src/utils/environment.ts`):
   - `isExtensionEnvironment()` - Checks if running in real extension
   - `isTestEnvironment()` - Checks if running in test
   - `isChromeMocked()` - Checks if Chrome APIs are mocked
   - `getEnvironmentType()` - Returns 'extension' | 'test' | 'unknown'
   - `logEnvironmentInfo()` - Logs detailed environment information

### Usage

```javascript
// In browser console or code
window.getEnvironmentType()  // Returns 'extension' or 'test'
window.isExtensionEnvironment()  // true in extension, false in test
window.isTestEnvironment()  // false in extension, true in test
window.logEnvironmentInfo()  // Logs detailed environment info
```

### Key Differences

| Feature | Real Extension | Test Environment |
|---------|---------------|------------------|
| `chrome.runtime.id` | Real extension ID (string) | Undefined or mock value |
| `window.chromeMessageHistory` | Not available | Available (for debugging) |
| `window.chromeMock` | Not available | Available (mock utilities) |
| Message passing | Real Chrome messaging | Simulated via mocks |
| Source maps | Available in dev mode | Available in dev mode |

## Quick Start

1. **Start development mode:**
   ```bash
   npm run dev        # Webpack watch mode (rebuilds on changes)
   ```

2. **In another terminal, start test server:**
   ```bash
   npm run test:full-flow    # Opens test page in browser
   ```

3. **Open Browser DevTools** (F12) - **NOT Cursor IDE breakpoints!**
   - IDE breakpoints won't work for browser code
   - You MUST use browser DevTools breakpoints
   - See [DEBUGGING_BREAKPOINTS.md](DEBUGGING_BREAKPOINTS.md) for detailed instructions

4. **Set breakpoints in DevTools:**
   - Go to Sources tab
   - Navigate to `webpack://` → `src` → your TypeScript files
   - Click line numbers to set breakpoints

5. **Test your changes** - Make code changes, webpack auto-rebuilds, refresh the test page

## Development Workflow

### Option 1: Full Flow Test Page (Recommended)

The full flow test page (`test/full-flow-test.html`) simulates the complete extension flow without requiring the extension to be loaded.

**Start:**
```bash
npm run dev:watch          # Terminal 1: Watch mode
npm run test:full-flow     # Terminal 2: Test server
```

**Features:**
- Mocks Chrome Extension APIs
- Loads content script and sidebar code directly
- Shows message flow in real-time
- Provides debug controls
- No extension reload needed

### Option 2: Browser Extension with Source Maps

For testing in the actual extension:

1. Build with source maps:
   ```bash
   npm run dev
   ```

2. Load extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

3. Open DevTools on any page
4. Set breakpoints in `Sources` tab → `webpack://` → your TypeScript files

## Debugging Features

### Source Maps

Source maps are automatically enabled in development mode, allowing you to:
- Set breakpoints in original TypeScript files
- See original variable names
- Step through original code structure

### Debugger Statements

Strategic `debugger;` statements are placed at key flow points. Enable them by setting flags in the browser console:

```javascript
// Enable breakpoints at different stages
window.__DEBUG_SEARCH__ = true;        // Entry to search handler
window.__DEBUG_RAG_SEARCH__ = true;    // Before RAG search
window.__DEBUG_RAG_RESULTS__ = true;   // After RAG search
window.__DEBUG_LLM_CALL__ = true;      // Before LLM call
window.__DEBUG_LLM_RESULT__ = true;    // After LLM call
window.__DEBUG_LLM_ERROR__ = true;     // On LLM error
window.__DEBUG_RESPONSE__ = true;      // Before sending response
window.__DEBUG_MESSAGES__ = true;      // On message receive
window.__DEBUG_SEARCH_ERROR__ = true;  // On search error
```

### Debug Helper Functions

Available in browser console:

#### Content Script Functions

```javascript
// Test search directly
await window.debugSearch('your query here');

// Inspect RAG state
window.debugRAG();

// View message history
window.debugMessages();

// Test LLM directly
await window.debugLLM('test prompt');
```

#### Test Bundle Functions

```javascript
// Create and initialize a RAG instance
const rag = await window.createTestRAG();

// Inspect RAG instance
window.debugRAGInstance(rag);
```

#### Logging Functions

```javascript
// Enable/disable logging
window.ragToggleLogging();
window.ragEnableLogging();
window.ragDisableLogging();

// Set log level (DEBUG, INFO, WARN, ERROR)
window.ragSetLogLevel('DEBUG');
window.ragGetLogLevel();

// Enable debug logging (DEBUG level + enabled)
window.enableDebugLogging();
```

### Chrome API Mocking

The test environment includes Chrome API mocks:

```javascript
// View message history
window.debugChromeMessages();

// Clear message history
window.clearChromeMessageHistory();

// Get listener count
window.getChromeMessageListeners();

// Manually trigger a message
window.triggerChromeMessage({ type: 'SEARCH', query: 'test' });
```

## Testing Scenarios

### Test Search Flow

1. Open `test/full-flow-test.html`
2. Click "Initialize RAG"
3. Enter a query and click "Search"
4. Set breakpoints in DevTools
5. Step through the code

### Test LLM Integration

1. Configure LLM settings in the test page
2. Use `window.debugLLM('test prompt')` in console
3. Inspect the response

### Test Message Flow

1. Open test page
2. Open DevTools console
3. Enable message debugging: `window.__DEBUG_MESSAGES__ = true`
4. Send a query
5. Step through message handlers

## Common Debugging Tasks

### Debug Search Not Working

```javascript
// 1. Check RAG state
window.debugRAG();

// 2. Test search directly
await window.debugSearch('test query');

// 3. Enable debug logging
window.enableDebugLogging();

// 4. Enable search breakpoints
window.__DEBUG_SEARCH__ = true;
window.__DEBUG_RAG_SEARCH__ = true;
```

### Debug LLM Issues

```javascript
// 1. Test LLM directly
await window.debugLLM('test prompt');

// 2. Check LLM config
await window.getLLMConfig();

// 3. Enable LLM breakpoints
window.__DEBUG_LLM_CALL__ = true;
window.__DEBUG_LLM_RESULT__ = true;
```

### Debug Message Flow

```javascript
// 1. View message history
window.debugChromeMessages();

// 2. Enable message breakpoints
window.__DEBUG_MESSAGES__ = true;

// 3. Check listeners
window.getChromeMessageListeners();
```

## Performance Debugging

### Enable Detailed Logging

```javascript
window.enableDebugLogging();
```

This enables DEBUG level logging which shows:
- RAG initialization steps
- Search operations
- LLM calls
- Message passing
- Performance metrics

### Monitor Message Flow

The test page shows real-time message flow in the sidebar panel, including:
- Message direction (outgoing/incoming)
- Message type
- Timestamp
- Message content preview

## Tips

1. **Use Conditional Breakpoints**: In DevTools, right-click a breakpoint to add conditions
   - Example: `message.query.includes('test')`

2. **Use Logpoints**: Instead of breakpoints, use logpoints to log values without pausing
   - Right-click line number → "Add logpoint"

3. **Watch Variables**: Add variables to "Watch" panel in DevTools

4. **Network Tab**: Monitor network requests for LLM API calls

5. **Console Tab**: Use console for quick testing with debug functions

## Troubleshooting

### Source Maps Not Working

- Ensure you're running `npm run dev` (development mode)
- Check DevTools → Sources → `webpack://` folder exists
- Try hard refresh (Ctrl+Shift+R / Cmd+Shift+R)

### Test Page Not Loading

- Ensure webpack has built: `npm run dev`
- Check browser console for errors
- Verify files exist in `dist/` folder

### Breakpoints Not Hitting

- Check that debugger flags are set: `window.__DEBUG_*__ = true`
- Verify source maps are enabled
- Try adding explicit `debugger;` statement in code

### Messages Not Flowing

- Check Chrome mock is loaded: `window.chrome` or `window.chromeMock`
- View message history: `window.debugChromeMessages()`
- Check listeners: `window.getChromeMessageListeners()`

## Next Steps

- See `test/full-flow-test.html` for the complete test interface
- Check `test/chrome-api-mock.js` for Chrome API mocking details
- Review `src/utils/logger.ts` for logging configuration
