# LLM-Based Content Extraction

## Overview

The extension now supports LLM-based content extraction, similar to [Crawl4AI](https://github.com/unclecode/crawl4ai). This uses Large Language Models to intelligently identify the main content area on web pages, handling complex patterns that rule-based heuristics might miss.

## Why LLM-Based Extraction?

- **Handles Complex Patterns**: LLMs understand semantic structure better than rules
- **Works on Any Site**: Adapts to different page layouts automatically
- **More Accurate**: Better at distinguishing content from navigation/ads
- **Future-Proof**: Learns from patterns without code changes

## Supported Providers

### 1. Transformers.js (Browser Local Models) - Recommended ⭐

**Best for**: Fast, private, offline content extraction

Transformers.js runs text generation models directly in your browser using WASM/WebGL, the same infrastructure used for embeddings. No API setup required!

**Setup:**
- No setup needed! Just enable it in config
- Models are automatically downloaded and cached (~300-600MB first time)
- Works offline after first download
- Uses GPU acceleration (WebGL) if available

**Configuration:**
```javascript
// In browser console
const config = {
  enabled: true,
  provider: 'transformers',
  model: 'Xenova/LaMini-Flan-T5-783M', // Recommended: fast, ~300MB
  timeout: 15000
};

await saveLLMConfig(config);
```

**Recommended Models:**
- **Xenova/LaMini-Flan-T5-783M** (Default, Recommended)
  - Type: text2text-generation
  - Size: ~300MB
  - Speed: Fast (~1-2 seconds per page)
  - Best for: Most use cases, good balance

- **Xenova/Qwen2.5-0.5B-Instruct**
  - Type: text-generation
  - Size: ~500MB
  - Speed: Medium (~2-3 seconds per page)
  - Best for: Better accuracy, slightly slower

- **Xenova/TinyLlama-1.1B-Chat-v1.0**
  - Type: text-generation
  - Size: ~600MB
  - Speed: Medium (~2-4 seconds per page)
  - Best for: Better instruction following

**Performance:**
- First load: Downloads model (~300-600MB, cached after)
- Subsequent loads: Instant (from cache)
- Inference: 1-3 seconds per page
- Memory: ~500MB-1GB during inference
- GPU: Automatic WebGL acceleration

**Fallback:**
If local model fails, automatically falls back to API (Ollama/OpenAI) if configured, otherwise uses heuristics.

### 2. Ollama (Local Server Models)

**Setup:**
1. Install [Ollama](https://ollama.ai/)
2. Pull a model: `ollama pull llama3.2` (or `mistral`, `phi3`, etc.)
3. Start Ollama: `ollama serve` (runs on `http://localhost:11434`)

**Configuration:**
```javascript
// In browser console
const config = {
  enabled: true,
  provider: 'ollama',
  apiUrl: 'http://localhost:11434/api/generate',
  model: 'llama3.2', // or 'mistral', 'phi3', etc.
  timeout: 10000
};

// Save config
localStorage.setItem('llmConfig', JSON.stringify(config));

// Or use the helper
await saveLLMConfig(config);
```

### 3. OpenAI API

**Configuration:**
```javascript
const config = {
  enabled: true,
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'your-api-key',
  model: 'gpt-4o-mini', // or 'gpt-3.5-turbo'
  timeout: 10000
};

await saveLLMConfig(config);
```

### 4. Custom API

**Configuration:**
```javascript
const config = {
  enabled: true,
  provider: 'custom',
  apiUrl: 'http://your-api-endpoint',
  model: 'your-model',
  apiKey: 'optional-key',
  timeout: 10000
};

await saveLLMConfig(config);
```

## How to Use

### Method 1: Console Configuration

1. Open browser console (F12)
2. Run:
```javascript
// Enable LLM extraction with Ollama
const config = {
  enabled: true,
  provider: 'ollama',
  apiUrl: 'http://localhost:11434/api/generate',
  model: 'llama3.2',
  timeout: 10000
};

// Save config
localStorage.setItem('llmConfig', JSON.stringify(config));

// Reload page to apply
location.reload();
```

### Method 2: Programmatic Configuration

```javascript
// Import the helper (if available globally)
import { saveLLMConfig, getLLMConfig } from './utils/llmContentExtraction';

// Save config
await saveLLMConfig({
  enabled: true,
  provider: 'ollama',
  apiUrl: 'http://localhost:11434/api/generate',
  model: 'llama3.2'
});

// Get current config
const config = await getLLMConfig();
console.log('Current LLM config:', config);
```

### Method 3: Extension Options Page (Future)

We'll add a UI in the extension options page for easy configuration.

## How It Works

1. **HTML Structure Extraction**: Extracts a simplified HTML structure (tags, IDs, classes, roles)
2. **LLM Prompt**: Sends structure to LLM with instructions to identify main content
3. **Selector Extraction**: LLM returns a CSS selector for the main content element
4. **Element Selection**: Finds the element using the selector
5. **Fallback**: If LLM fails, falls back to heuristic-based extraction

## Example LLM Prompt

```
You are analyzing a web page to identify the main content area...

HTML Structure:
div#main (5 children, ~500 chars)
  section.content (3 children, ~300 chars)
  nav (10 children, ~50 chars)
  footer (2 children, ~20 chars)

Instructions:
1. Identify the element containing main article/content
2. Return ONLY a CSS selector
3. Example: "main" or "#content" or ".article-content"

CSS Selector:
```

## Performance

- **Ollama (Local)**: ~1-3 seconds per page (depends on model)
- **OpenAI API**: ~500ms-2s per page (network dependent)
- **Fallback**: < 10ms (heuristics)

## Troubleshooting

### LLM Not Responding

1. **Check Ollama is running**: `curl http://localhost:11434/api/tags`
2. **Check model is available**: `ollama list`
3. **Test API directly**:
```javascript
fetch('http://localhost:11434/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama3.2',
    prompt: 'test',
    stream: false
  })
}).then(r => r.json()).then(console.log);
```

### LLM Returns Invalid Selector

- The LLM might return an invalid selector
- System automatically falls back to heuristics
- Check console logs for the returned selector

### CORS Issues

- Ollama running locally should work fine
- For remote APIs, ensure CORS is configured
- Browser extensions can bypass CORS for their own requests

## Disabling LLM Extraction

```javascript
const config = {
  enabled: false
};

localStorage.setItem('llmConfig', JSON.stringify(config));
location.reload();
```

## Comparison: LLM vs Heuristics

| Feature | Heuristics | LLM |
|---------|-----------|-----|
| **Speed** | Fast (< 10ms) | Slower (1-3s) |
| **Accuracy** | Good for common patterns | Excellent for complex patterns |
| **Setup** | None | Requires LLM setup |
| **Cost** | Free | Free (local) or paid (API) |
| **Reliability** | Works on most sites | Works on all sites |

## Best Practices

1. **Start with Heuristics**: Try heuristics first, use LLM if it fails
2. **Use Local Models**: Ollama is free and private
3. **Cache Results**: LLM results can be cached per URL
4. **Fallback Always**: Always have heuristics as fallback
5. **Monitor Performance**: LLM adds latency, use only when needed

## Future Enhancements

- [ ] Extension options UI for LLM configuration
- [ ] Automatic model selection based on page complexity
- [ ] Caching LLM results per URL
- [ ] Batch processing for multiple pages
- [ ] Support for more LLM providers (Anthropic, Cohere, etc.)

## References

- [Crawl4AI](https://github.com/unclecode/crawl4ai) - Inspiration for LLM-based extraction
- [Ollama](https://ollama.ai/) - Local LLM runtime
- [Readability.js](https://github.com/mozilla/readability) - Heuristic-based extraction

