# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**BrowseIQ** (package name: `pagewise`) — a client-side RAG browser extension that lets users query any webpage using semantic search. All ML inference runs in-browser via WASM; nothing leaves the browser unless the user configures an Ollama/OpenAI backend for answer generation.

## Commands

```bash
npm install          # install dependencies
npm run build        # production build → dist/
npm run dev          # webpack watch mode (incremental rebuild)
npm run test:server  # start http-server on :8080 and open test/local-test.html
```

There is no automated test runner. All testing is browser-based (see **Testing** below).

TypeScript is checked implicitly by `ts-loader` during build. There is no separate `tsc` or lint step.

## Architecture

### Extension entry points (webpack)

| Entry | Purpose |
|---|---|
| `content-script` | Injected into every page; owns `PageRAG`, sidebar iframe, highlight CSS |
| `background` | Service worker; proxies Ollama/OpenAI requests to bypass CORS |
| `worker` | Web Worker; offloads `EmbeddingService` from main thread |
| `popup` | Extension toolbar popup UI |
| `sidebar` | Sidebar panel loaded as `chrome-extension://` URL inside an iframe |
| `options` | Extension options page |
| `test-bundle` | Standalone bundle for browser-console testing |

Static assets (`manifest.json`, HTML files) are copied from `public/` and `src/extension/*/` into `dist/` by `CopyWebpackPlugin`.

### Core RAG pipeline (`src/core/`)

```
DomChunker → EmbeddingService → VectorStore ← PageRAG (orchestrator)
```

- **`DomChunker`** — Walks the DOM to produce `Chunk[]`. Uses heading hierarchy (h1–h6) as section boundaries. Delegates main-content detection to `contentExtraction.ts` (heuristic) or optionally `llmContentExtraction.ts` (LLM-assisted, disabled by default).
- **`EmbeddingService`** — Singleton. Loads `Xenova/all-MiniLM-L6-v2` (quantized) via Transformers.js. Intercepts `fetch` to cache HuggingFace model files in Cache Storage (7-day TTL) so the ~20 MB download only happens once.
- **`VectorStore`** — Orama in-memory DB (BM25 keyword) + manual cosine similarity over `embeddings: Map<chunkId, number[]>`. Embeddings are persisted per-URL in IndexedDB (`embeddings_orama-<hostname>-<pathHash>`). A content hash detects page changes and invalidates stale embeddings.
- **`PageRAG`** — Orchestrates the four steps: init embedder → init store → chunk DOM → embed chunks (or restore from cache) → `insertChunks`. `search()` runs hybrid query (50% BM25 + 50% vector). `highlightResult()` adds `.rag-highlight` and scrolls to element via CSS selector or XPath.
- **`LocalModelService`** — Singleton for answer generation (not used in search path). Supports `transformers` (local WASM), `ollama`, `openai`, or `custom` OpenAI-compatible APIs.

### Key data types (`src/types/index.ts`)

`Chunk` carries `text` (embedding input), `metadata.raw_text` (display), `metadata.xpath`/`cssSelector` (element location), `metadata.headingPath[]` (section context), and optional quality/BM25 scores.

### Background ↔ content-script message protocol

`background.ts` handles: `INJECT_CONTENT_SCRIPT`, `OLLAMA_REQUEST`, `OLLAMA_STREAM_START` (via long-lived `chrome.runtime.Port`), `OPENAI_REQUEST`, `LIST_MODELS`. All async handlers return `true` to keep the message channel open.

The keyboard shortcut `Ctrl+Shift+K` / `Cmd+Shift+K` triggers `TOGGLE_SIDEBAR` from background to the active tab.

## Testing

Browser-based only. Preferred workflow:

1. `npm run build` (or `npm run dev` in one terminal)
2. `npm run test:server` → opens `http://localhost:8080/test/local-test.html`
3. Click **Initialize**, wait for model load (first run ~1–2 min download), then run queries.

For console testing on any live page, inject `http://localhost:8080/dist/test-bundle.js` and use:
```javascript
const rag = new PageRAG();
await rag.init();
const results = await rag.search("your query");
rag.highlightResult(results[0]);
```

To load as an unpacked extension: build → Chrome → `chrome://extensions/` → Developer mode → Load unpacked → select `dist/`.

## Extension CSP

`manifest.json` allows `connect-src` to `localhost:11434` (Ollama) and `huggingface.co`/`cdn.jsdelivr.net` (model download). Changing these domains requires updating both `manifest.json` and ensuring the fetch interceptor in `EmbeddingService` covers the new origin.
