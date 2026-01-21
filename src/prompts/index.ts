/**
 * Prompts module
 * Centralized location for all LLM prompts used in the application
 */

export { getAgentSystemPrompt } from './agentSystemPrompt';
export { createContentExtractionPrompt } from './contentExtractionPrompt';
export { 
  createRAGPromptWithHistory, 
  createRAGPromptWithoutHistory,
  type RAGPromptOptions 
} from './ragAnswerPrompt';
