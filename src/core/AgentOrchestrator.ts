/**
 * Agent Orchestrator
 * Manages agent loop with tool calling support using AI SDK native tool calling
 */

import { generateText, streamText } from 'ai';
import { ToolRegistry, type ToolCall, type ToolResult, convertToolsToAISDK } from './AgentTools';
import { createAISDKModel, convertLLMConfigToAISDKConfig } from './AISDKProvider';
import type { LLMConfig } from '../utils/llmContentExtraction';

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AgentOptions {
  maxSteps?: number;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolCall: ToolCall, result: ToolResult) => void;
  onStep?: (step: number, message: string) => void;
}

export interface AgentResponse {
  message: string;
  toolCalls?: Array<{ toolCall: ToolCall; result: ToolResult }>;
  steps: number;
}

/**
 * Agent Orchestrator class using AI SDK native tool calling
 */
export class AgentOrchestrator {
  private model: any | null | undefined = undefined; // AI SDK LanguageModel (type varies by provider)
  private aiSdkConfig: any; // Store config for initialization
  private toolRegistry: ToolRegistry;
  private maxSteps: number;
  private fallbackToManual: boolean = false; // Fallback for Transformers.js

  constructor(
    llmConfig: LLMConfig,
    toolRegistry: ToolRegistry,
    options: { maxSteps?: number } = {}
  ) {
    // Convert LLM config to AI SDK config
    this.aiSdkConfig = convertLLMConfigToAISDKConfig(llmConfig);
    this.toolRegistry = toolRegistry;
    this.maxSteps = options.maxSteps || 3;
    // Check if provider is transformers (doesn't support tool calling)
    this.fallbackToManual = this.aiSdkConfig.provider === 'transformers';
  }

  /**
   * Initialize model (now synchronous since we use static imports)
   */
  private ensureModel(): void {
    if (this.model !== undefined) {
      return; // Already initialized
    }

    // Create model synchronously (no longer async)
    this.model = createAISDKModel(this.aiSdkConfig);
    
    // Check if model is null (Transformers.js case)
    if (this.model === null) {
      this.fallbackToManual = true;
    }
  }

  /**
   * Run agent with tool calling support using AI SDK
   */
  async run(
    query: string,
    conversationHistory: AgentMessage[] = [],
    options: AgentOptions = {}
  ): Promise<AgentResponse> {
    // Initialize model if needed
    this.ensureModel();

    // Fallback to manual mode for Transformers.js
    if (this.fallbackToManual || !this.model) {
      throw new Error('Native tool calling not supported. Use a provider that supports tool calling (Ollama, OpenAI, or Custom API).');
    }

    const maxSteps = options.maxSteps || this.maxSteps;
    
    // Convert tools to AI SDK format
    const tools = convertToolsToAISDK(this.toolRegistry);
    
    // Convert conversation history to AI SDK format
    const messages = conversationHistory.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content
    }));

    // Add current query as user message
    messages.push({
      role: 'user',
      content: query
    });

    if (options.onStep) {
      options.onStep(1, 'Analyzing query...');
    }

    // Track tool calls and results
    const trackedToolCalls: Array<{ toolCall: ToolCall; result: ToolResult }> = [];

    // Use AI SDK generateText with tools
    const result = await generateText({
      model: this.model,
      messages: messages,
      tools: tools,
      maxSteps: maxSteps,
      onStepFinish: (stepResult: any) => {
        // Handle tool calls and results from step result
        if (stepResult.toolCalls && stepResult.toolCalls.length > 0) {
          stepResult.toolCalls.forEach((toolCall: any) => {
            const ourToolCall: ToolCall = {
              name: toolCall.toolName,
              arguments: toolCall.args,
              id: toolCall.toolCallId
            };
            
            if (options.onToolCall) {
              options.onToolCall(ourToolCall);
            }
          });
        }

        if (stepResult.toolResults && stepResult.toolResults.length > 0) {
          stepResult.toolResults.forEach((toolResult: any, index: number) => {
            if (stepResult.toolCalls && stepResult.toolCalls[index]) {
              const toolCall = stepResult.toolCalls[index];
              const ourToolCall: ToolCall = {
                name: toolCall.toolName,
                arguments: toolCall.args,
                id: toolCall.toolCallId
              };
              
              const ourResult: ToolResult = {
                success: !toolResult.error,
                data: toolResult.result,
                error: toolResult.error
              };
              
              if (options.onToolResult) {
                options.onToolResult(ourToolCall, ourResult);
              }
              
              trackedToolCalls.push({ toolCall: ourToolCall, result: ourResult });
            }
          });
        }

        if (options.onStep) {
          const stepType = stepResult.stepType || 'unknown';
          const message = stepResult.toolCalls && stepResult.toolCalls.length > 0 
            ? 'Processing tool results...' 
            : 'Generating response...';
          options.onStep(trackedToolCalls.length + 1, message);
        }
      }
    });

    // Extract tool calls from result steps if available
    if (result.steps) {
      const steps = await result.steps;
      for (const step of steps) {
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const toolCall of step.toolCalls) {
            const ourToolCall: ToolCall = {
              name: toolCall.toolName,
              arguments: toolCall.args,
              id: toolCall.toolCallId
            };
            
            // Find corresponding result
            if (step.toolResults) {
              const toolResult = step.toolResults.find((tr: any) => tr.toolCallId === toolCall.toolCallId);
              if (toolResult) {
                const ourResult: ToolResult = {
                  success: !(toolResult as any).error,
                  data: (toolResult as any).result,
                  error: (toolResult as any).error
                };
                // Only add if not already tracked
                if (!trackedToolCalls.find(tc => tc.toolCall.id === ourToolCall.id)) {
                  trackedToolCalls.push({ toolCall: ourToolCall, result: ourResult });
                }
              }
            }
          }
        }
      }
    }

    const steps = result.steps ? await result.steps : [];
    
    return {
      message: result.text,
      toolCalls: trackedToolCalls.length > 0 ? trackedToolCalls : undefined,
      steps: steps.length || 1
    };
  }

  /**
   * Run agent with streaming support using AI SDK
   */
  async runStreaming(
    query: string,
    conversationHistory: AgentMessage[] = [],
    options: AgentOptions & {
      onChunk?: (chunk: string) => void;
    } = {}
  ): Promise<AgentResponse> {
    // Initialize model if needed
    this.ensureModel();

    // Fallback to manual mode for Transformers.js
    if (this.fallbackToManual || !this.model) {
      throw new Error('Native tool calling not supported. Use a provider that supports tool calling (Ollama, OpenAI, or Custom API).');
    }

    const maxSteps = options.maxSteps || this.maxSteps;
    
    // Convert tools to AI SDK format
    const tools = convertToolsToAISDK(this.toolRegistry);
    
    // Convert conversation history to AI SDK format
    const messages = conversationHistory.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content
    }));

    // Add current query as user message
    messages.push({
      role: 'user',
      content: query
    });

    if (options.onStep) {
      options.onStep(1, 'Analyzing query...');
    }

    let accumulatedText = '';
    const trackedToolCalls: Array<{ toolCall: ToolCall; result: ToolResult }> = [];

    // Use AI SDK streamText with tools
    const result = await streamText({
      model: this.model,
      messages: messages,
      tools: tools,
      maxSteps: maxSteps,
      onStepFinish: (stepResult: any) => {
        // Track tool calls and results from step result
        if (stepResult.toolCalls && stepResult.toolCalls.length > 0) {
          stepResult.toolCalls.forEach((toolCall: any) => {
            const ourToolCall: ToolCall = {
              name: toolCall.toolName,
              arguments: toolCall.args,
              id: toolCall.toolCallId
            };
            
            if (options.onToolCall) {
              options.onToolCall(ourToolCall);
            }
          });
        }

        if (stepResult.toolResults && stepResult.toolResults.length > 0) {
          stepResult.toolCalls?.forEach((toolCall: any, index: number) => {
            if (stepResult.toolResults[index]) {
              const ourToolCall: ToolCall = {
                name: toolCall.toolName,
                arguments: toolCall.args,
                id: toolCall.toolCallId
              };
              
              const toolResult = stepResult.toolResults[index];
              const ourResult: ToolResult = {
                success: !toolResult.error,
                data: toolResult.result,
                error: toolResult.error
              };
              
              if (options.onToolResult) {
                options.onToolResult(ourToolCall, ourResult);
              }
              
              // Store for final response
              trackedToolCalls.push({ toolCall: ourToolCall, result: ourResult });
            }
          });
        }

        if (options.onStep) {
          const stepType = stepResult.stepType || 'unknown';
          const message = stepResult.toolCalls && stepResult.toolCalls.length > 0 
            ? 'Processing tool results...' 
            : 'Generating response...';
          options.onStep(trackedToolCalls.length + 1, message);
        }
      }
    });

    // Stream the response
    for await (const chunk of result.textStream) {
      accumulatedText += chunk;
      if (options.onChunk) {
        options.onChunk(chunk);
      }
    }

    // Get steps count
    const steps = result.steps ? await result.steps : [];

    return {
      message: accumulatedText,
      toolCalls: trackedToolCalls.length > 0 ? trackedToolCalls : undefined,
      steps: steps.length || 1
    };
  }
}
