# How to Debug with Breakpoints

## ⚠️ CRITICAL: IDE Breakpoints Don't Work for Browser Code

**Cursor IDE breakpoints will NOT work** for code running in the browser. You must use **browser DevTools breakpoints** instead.

### Why?
- IDE breakpoints work for Node.js/server-side code
- Browser code runs in a completely different environment (the browser's JavaScript engine)
- Source maps connect browser code to your TypeScript files, but only in **browser DevTools**, not in your IDE

## Why IDE Breakpoints Don't Work

- IDE breakpoints work for Node.js/server-side code
- Browser code runs in a different environment (the browser's JavaScript engine)
- Source maps connect browser code to your TypeScript files, but only in DevTools

## How to Debug Properly

### Step 1: Verify Build is in Development Mode

Make sure you're running in development mode and source maps are generated:

```bash
# Terminal 1: Start webpack in watch mode
npm run dev

# Wait for build to complete, then check:
ls -la dist/content-script.js.map
```

If the `.map` file doesn't exist:
1. Stop webpack (Ctrl+C)
2. Delete `dist` folder: `rm -rf dist`
3. Run `npm run dev` again
4. Verify source maps are generated

### Step 2: Open Browser DevTools

1. Open your test page: `http://localhost:8080/test/full-flow-test.html`
2. Press **F12** (or right-click → Inspect) to open DevTools
3. Go to the **Sources** tab

### Step 3: Find Your TypeScript Files

In the Sources tab, you'll see a file tree. Look for:

```
webpack://
  └── .
      └── src
          └── extension
              └── content-script.ts
```

**If you don't see `webpack://` folder:**

1. **Check browser console** for errors:
   - Open Console tab (F12)
   - Look for: "Failed to load source map" or "Source map error"
   
2. **Check Network tab:**
   - Go to Network tab in DevTools
   - Reload the page
   - Look for requests to `.map` files
   - If they're 404, source maps aren't being served
   
3. **Verify source maps exist:**
   ```bash
   ls -la dist/*.map
   ```
   
4. **Hard refresh the page:**
   - Chrome: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
   - This clears cache and forces reload of source maps

5. **Try opening file directly:**
   - Press Ctrl+P (Windows/Linux) or Cmd+P (Mac) in Sources tab
   - Type: `content-script.ts`
   - If it appears, source maps are working

### Step 4: Set Breakpoints in DevTools

1. Navigate to your TypeScript file in the Sources tab
2. Click on the line number where you want to break
3. A blue dot appears = breakpoint is set
4. Interact with your test page
5. Execution will pause at your breakpoint

### Step 5: Use Conditional Breakpoints

Right-click a breakpoint to add a condition:

```javascript
// Example: Only break when query contains "test"
message.query.includes('test')
```

## Alternative: Use `debugger;` Statements (Easiest Method)

Instead of setting breakpoints in DevTools, add `debugger;` statements directly in your code:

```typescript
async function handleSearch(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): Promise<void> {
  debugger; // Execution will pause here if DevTools is open
  // ... rest of code
}
```

**Steps:**
1. Add `debugger;` statement in your TypeScript file
2. Save the file (webpack auto-rebuilds)
3. Open browser DevTools (F12) - **MUST be open before execution**
4. Refresh test page
5. Interact with page - execution pauses at `debugger;`

**Note:** 
- `debugger;` only works when DevTools is open
- This is often easier than finding files in Sources tab
- You can add multiple `debugger;` statements to trace execution flow

## Enable Debug Flags

You can also use the debug flags we set up:

```javascript
// In browser console, before interacting:
window.__DEBUG_SEARCH__ = true;        // Break at search entry
window.__DEBUG_RAG_SEARCH__ = true;    // Break before RAG search
window.__DEBUG_LLM_CALL__ = true;      // Break before LLM call
```

These flags trigger `debugger;` statements at key points.

## Troubleshooting

### Source Maps Not Loading

1. **Check build output:**
   ```bash
   ls -la dist/*.map
   ```
   You should see `.map` files for each `.js` file.

2. **Check browser console:**
   Look for errors like:
   - "Failed to load source map"
   - "Source map error"

3. **Verify webpack config:**
   ```javascript
   devtool: isProduction ? false : 'source-map'
   ```

4. **Hard refresh:**
   - Chrome: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
   - This clears cache and reloads source maps

### Breakpoints Not Hitting

1. **Verify DevTools is open** - `debugger;` only works with DevTools open
2. **Check the file is actually being executed** - Add `console.log()` to verify
3. **Verify you're setting breakpoints in the right file** - Check the call stack
4. **Try `debugger;` statement** - If that works, source maps are fine

### Can't Find TypeScript Files in Sources

1. **Check webpack:// folder exists** in Sources tab
2. **Try searching** for your file: Ctrl+P (Windows/Linux) or Cmd+P (Mac)
3. **Verify source maps are generated:**
   ```bash
   # Check if .map files exist
   find dist -name "*.map"
   ```

## Quick Debug Workflow

1. **Terminal 1:** `npm run dev` (watch mode)
   - Wait for build to complete
   - Verify: `ls dist/content-script.js.map` exists

2. **Terminal 2:** `npm run test:full-flow` (test server)
   - Opens browser automatically

3. **Browser DevTools:** 
   - Press **F12** (or right-click → Inspect)
   - **IMPORTANT:** Use browser DevTools, NOT Cursor IDE breakpoints!

4. **Sources Tab:**
   - Click "Sources" tab in DevTools
   - Look for `webpack://` folder
   - Navigate to: `webpack://` → `.` → `src` → `extension` → `content-script.ts`

5. **Set Breakpoint:**
   - Click on line number (e.g., line 513 in `handleSearch`)
   - Blue dot appears = breakpoint set

6. **Interact with Test Page:**
   - Enter a query
   - Click "Search"
   - Execution should pause at your breakpoint

7. **If breakpoint doesn't hit:**
   - Check DevTools is open (breakpoints only work with DevTools open)
   - Try using `debugger;` statement instead (see below)
   - Check console for errors
   - Verify you're setting breakpoint in the right function

## Pro Tips

1. **Use logpoints instead of breakpoints:**
   - Right-click line number → "Add logpoint"
   - Logs values without pausing execution

2. **Use the Call Stack:**
   - When paused, check Call Stack panel
   - See how you got to this point

3. **Watch variables:**
   - Add variables to "Watch" panel
   - See values update as you step through

4. **Step controls:**
   - F10: Step over
   - F11: Step into
   - Shift+F11: Step out
   - F8: Continue

## Example: Debugging a Search Query

### Method 1: Using `debugger;` Statement (Recommended)

1. **Edit `src/extension/content-script.ts`:**
   ```typescript
   async function handleSearch(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): Promise<void> {
     debugger; // Add this line
     // ... rest of code
   }
   ```

2. **Save file** (webpack auto-rebuilds)

3. **Open browser DevTools** (F12) - **MUST be open**

4. **Refresh test page** (Ctrl+Shift+R or Cmd+Shift+R)

5. **Enter query and click Search**

6. **Execution pauses** at `debugger;` statement

7. **Inspect variables:**
   - Hover over `message` to see query
   - Check `sender` object
   - Use Watch panel to monitor variables

8. **Step through code:**
   - F10: Step over
   - F11: Step into
   - F8: Continue

### Method 2: Using DevTools Breakpoints

1. **Open DevTools** (F12) → **Sources** tab

2. **Find file:**
   - Press Ctrl+P (Windows/Linux) or Cmd+P (Mac)
   - Type: `content-script.ts`
   - Click on the file

3. **Set breakpoint:**
   - Find `handleSearch` function (around line 511)
   - Click line number 513
   - Blue dot appears

4. **Enter query in test page and click Search**

5. **Execution pauses** at breakpoint

6. **Inspect and step through** as above

### Method 3: Using Debug Flags

1. **Open browser console** (F12 → Console tab)

2. **Enable debug flag:**
   ```javascript
   window.__DEBUG_SEARCH__ = true;
   ```

3. **Enter query and click Search**

4. **Execution pauses** at conditional `debugger;` statement

5. **Debug as above**
