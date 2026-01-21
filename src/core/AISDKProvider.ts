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
  provider: 'ollama' | 'openai' | 'custom' | 'transformers';
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
      const baseUrl = config.apiUrl || 'http://localhost:11434/api';
      // Ensure baseUrl ends with /api
      const normalizedBaseUrl = baseUrl.endsWith('/api') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/api`;
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
  return {
    provider: llmConfig.provider || 'transformers',
    model: llmConfig.model || (llmConfig.provider === 'ollama' ? 'llama3' : 'gpt-3.5-turbo'),
    apiUrl: llmConfig.apiUrl,
    apiKey: llmConfig.apiKey
  };
}
