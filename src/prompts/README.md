# Prompts Module

This directory contains all LLM prompts used throughout the application. Centralizing prompts makes them easier to manage, update, and maintain.

## Structure

- `agentSystemPrompt.ts` - System prompt for agent mode with tool calling
- `contentExtractionPrompt.ts` - Prompt for LLM-based content extraction
- `ragAnswerPrompt.ts` - Prompts for RAG answer generation
- `index.ts` - Central export file

## Usage

### Agent System Prompt

```typescript
import { getAgentSystemPrompt } from '../prompts';

const systemPrompt = getAgentSystemPrompt(hasWebSearchTool);
if (systemPrompt) {
  messages.push({ role: 'system', content: systemPrompt });
}
```

### Content Extraction Prompt

```typescript
import { createContentExtractionPrompt } from '../prompts';

const prompt = createContentExtractionPrompt(htmlStructure, url);
```

### RAG Answer Prompts

```typescript
import { createRAGPromptWithHistory, createRAGPromptWithoutHistory } from '../prompts';

// With conversation history
const prompt = createRAGPromptWithHistory({
  query: 'What is...',
  context: '...',
  conversationHistory: [...]
});

// Without conversation history
const prompt = createRAGPromptWithoutHistory({
  query: 'What is...',
  context: '...'
});
```

## Adding New Prompts

1. Create a new file in this directory (e.g., `newPrompt.ts`)
2. Export a function that returns the prompt string
3. Add the export to `index.ts`
4. Import and use in your code

## Benefits

- **Centralized Management**: All prompts in one place
- **Easy Updates**: Change prompts without touching business logic
- **Version Control**: Track prompt changes in git
- **Reusability**: Share prompts across different modules
- **Testing**: Easier to test and validate prompts
