# Storage Guide: Where is Data Stored?

## Current Storage Architecture

### 1. **Orama Vector Store** (In-Memory)
- **Location**: Currently stored **in-memory** (RAM)
- **Persistence**: **NOT persisted** to IndexedDB yet (data lost on page reload)
- **Database Name**: `orama-{hostname}-{pathHash}`
  - Example: `orama-example-com-abc123`
- **Contains**: Chunks with text, metadata, and search indices

### 2. **Transformers.js Model Cache** (IndexedDB)
- **Location**: **IndexedDB** (persisted)
- **Database Name**: Usually `transformers-cache` or similar
- **Contains**: 
  - Model weights (~20MB)
  - Model configuration files
  - Cached embeddings (if any)
- **Persistence**: ✅ **Persisted** - survives page reloads

### 3. **Extension Storage** (Chrome Storage API)
- **Location**: Chrome's extension storage (IndexedDB backend)
- **Contains**: Extension settings, preferences
- **Persistence**: ✅ **Persisted**

## How to Inspect Storage

### Method 1: Chrome DevTools (Easiest)

1. **Open DevTools** (F12)
2. **Go to Application tab**
3. **In left sidebar, expand "Storage"**
4. **Click "IndexedDB"**
5. **You'll see:**
   - Transformers.js cache database
   - Any Orama databases (if persisted)
   - Other extension databases

### Method 2: Browser Console

After initializing PageRAG, run in console:

```javascript
// Get storage info
const rag = new PageRAG();
await rag.init();

// Inspect storage
const storageInfo = await rag.getStorageInfo();
console.log('Storage Info:', storageInfo);

// Or use the global function
const info = await inspectStorage();
console.log('All IndexedDB databases:', info.indexedDB.databases);
console.log('Transformers cache:', info.indexedDB.transformersCache);
console.log('Orama databases:', info.indexedDB.oramaDatabases);
```

### Method 3: Inspect Specific Database

```javascript
// Inspect a specific IndexedDB database
const dbInfo = await inspectIndexedDB('transformers-cache');
console.log('Database structure:', dbInfo);
```

## Storage Locations

### On Disk (Chrome)

**Windows:**
```
%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB
```

**macOS:**
```
~/Library/Application Support/Google/Chrome/Default/IndexedDB
```

**Linux:**
```
~/.config/google-chrome/Default/IndexedDB
```

### Database Names

- **Transformers.js**: Usually `transformers-cache` or `xenova-transformers`
- **Orama**: `orama-{hostname}-{hash}` (currently in-memory only)
- **Extension**: Extension ID-based databases

## Important Notes

### Current Limitation

⚠️ **Orama data is NOT persisted yet** - it's stored in-memory only. This means:
- Chunks are lost when you reload the page
- You need to re-initialize on each page load
- This is by design for now (ephemeral RAG)

### Future Enhancement

To persist Orama to IndexedDB, we would need to:
1. Install `@orama/plugin-data-persistence`
2. Use the `persist()` and `restore()` functions
3. Save/load database on page load

### Transformers.js Cache

✅ **Model cache IS persisted** - the ~20MB model downloads once and is cached in IndexedDB. Subsequent loads are much faster.

## Viewing Data in DevTools

1. **Open DevTools** → **Application** tab
2. **IndexedDB** → Find your database
3. **Expand** to see object stores
4. **Click on object store** to see data
5. **Double-click** on a record to view/edit

## Clearing Storage

### Clear Transformers Cache
```javascript
// In console
indexedDB.deleteDatabase('transformers-cache');
```

### Clear All Extension Storage
- DevTools → Application → Storage → Clear site data
- Or: Extension → Options page → Clear data

### Clear Orama (In-Memory)
```javascript
// In console
const rag = new PageRAG();
await rag.reprocess(); // This clears and re-initializes
```

## Storage Size

- **Transformers.js model**: ~20MB (one-time download, cached)
- **Orama chunks**: ~few KB to MB (depends on page size, in-memory)
- **Total**: Usually < 25MB per domain

## Troubleshooting

### Can't see IndexedDB databases?
- Make sure you're on the correct origin (same domain)
- Check if extension has storage permissions
- Try refreshing DevTools

### Data not persisting?
- Orama is in-memory by design (ephemeral)
- Transformers.js cache should persist automatically
- Check browser storage settings (might be disabled)

