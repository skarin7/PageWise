# Master Plan – PageWise

## Project overview

PageWise is a client-side RAG browser extension: semantic search over the current page, optional LLM (Ollama/OpenAI/Transformers), agent orchestration, and a Define feature (word → knowledge-base references).

## Tech stack

- **Backend / core:** TypeScript in `src/core/`, `src/utils/`, `src/types/`
- **Frontend / extension:** Vanilla HTML + TypeScript + CSS in `src/extension/` (popup, sidebar, options, content script)
- **Testing:** Vitest; tests in `src/**/*.test.ts` or `__tests__/`
- **Define API:** Optional REST server in `server/` (run with `npm run define-server`)

## Current status

- RAG, embeddings, vector store, sidebar chat, and agent tools are implemented.
- **Define feature:** Double-click or select a word → “Define” popover → fetches references from configurable API (Options → Define API URL). Default server: `http://127.0.0.1:3001`.
- **Add to context:** Sidebar has a "+" control at bottom-left; user can add a page URL or paste document text to include in chat context. Stored per tab; background fetches URL content when building agent context.
- **Outstanding:** Fix `src/utils/__tests__/contentFilter.test.ts` (TS errors) so `npm run build` passes.

## How to update this plan

- Use **`/plan`** in chat to refresh status and milestones.
- Lead architect rule expects this file to be read before answering and updated when the plan changes.
