/**
 * AI SDK Provider Factory
 * Creates appropriate AI SDK model instances based on provider configuration
 * 
 * Note: Using static imports instead of dynamic imports to avoid CSP issues
 * with chunk loading in browser extensions.
 */

import { createOllama } from 'ollama-ai-provider';
import { createOpenAI } from '@ai-sdk/openai';
import type { LLMConfig } from '../utils/llmContentExtraction';

export interface AISDKProviderConfig {
  provider: 'ollama' | 'openai' | 'openrouter' | 'custom' | 'transformers';
  model: string;
  apiUrl?: string;
  apiKey?: string;
}

/**
 * Create AI SDK model instance based on provider configuration
 * Returns null for Transformers.js (doesn't support native tool calling)
 */
export function createAISDKModel(config: AISDKProviderConfig): any {
  switch (config.provider) {
    case 'ollama': {
      // Normalize Ollama URL - handle various formats users might enter
      let baseUrl = config.apiUrl || 'http://localhost:11434';
      
      // Remove common Ollama endpoint paths that users might include
      baseUrl = baseUrl
        .replace(/\/api\/generate$/, '')  // Remove /api/generate
        .replace(/\/api\/chat$/, '')      // Remove /api/chat
        .replace(/\/api\/tags$/, '')      // Remove /api/tags
        .replace(/\/generate$/, '')       // Remove /generate
        .replace(/\/chat$/, '')           // Remove /chat
        .replace(/\/$/, '');              // Remove trailing slash
      
      // Ensure baseUrl ends with /api (ollama-ai-provider expects this)
      // Default Ollama server runs on http://localhost:11434, API is at /api
      const normalizedBaseUrl = baseUrl.endsWith('/api') 
        ? baseUrl 
        : `${baseUrl}/api`;
      
      console.log('[AISDKProvider] Ollama baseURL normalized:', {
        original: config.apiUrl,
        normalized: normalizedBaseUrl
      });
      
      const ollamaProvider = createOllama({
        baseURL: normalizedBaseUrl
      });
      return ollamaProvider(config.model);
    }
    
    case 'openai': {
      if (!config.apiKey) {
        throw new Error('OpenAI API key is required');
      }
      const openaiProvider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.apiUrl || 'https://api.openai.com/v1'
      });
      return openaiProvider(config.model);
    }
    
    case 'custom': {
      // Custom OpenAI-compatible API
      if (!config.apiKey || !config.apiUrl) {
        throw new Error('Custom API requires both apiKey and apiUrl');
      }
      const customProvider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.apiUrl
      });
      return customProvider(config.model);
    }
    
    case 'transformers':
      // Transformers.js doesn't support native tool calling
      return null;
    
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

/**
 * Convert LLMConfig to AISDKProviderConfig
 */
export function convertLLMConfigToAISDKConfig(llmConfig: LLMConfig): AISDKProviderConfig {
  // Map openrouter to the provider type
  const provider = (llmConfig.provider === 'openrouter' ? 'openrouter' : llmConfig.provider) || 'transformers';
  
  // Set default model based on provider
  let defaultModel = 'gpt-3.5-turbo';
  if (provider === 'ollama') {
    defaultModel = 'llama3';
  } else if (provider === 'openrouter') {
    defaultModel = 'openai/gpt-3.5-turbo'; // OpenRouter model format
  }
  
  return {
    provider: provider as any,
    model: llmConfig.model || defaultModel,
    apiUrl: llmConfig.apiUrl,
    apiKey: llmConfig.apiKey
  };
}
