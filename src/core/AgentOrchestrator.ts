/**
 * Agent Orchestrator
 * Manages agent loop with tool calling support
 */

import { LocalModelService } from './LocalModelService';
import { ToolRegistry, type ToolCall, type ToolResult } from './AgentTools';
import { parseToolCall, hasToolCall } from './toolCallParser';

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
 * Create system prompt with tool definitions
 */
function createSystemPrompt(toolRegistry: ToolRegistry): string {
  const toolDefinitions = toolRegistry.getToolDefinitions();
  
  return `You are a helpful AI assistant that can use tools to help answer questions.

Available Tools:
${toolDefinitions}

Instructions:
1. When you need to use a tool, respond with a JSON object in this format:
   {"tool": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}

2. Only use tools when necessary. For questions about the current page content, use your knowledge directly.

3. After receiving tool results, synthesize them into a clear, helpful answer.

4. You can make multiple tool calls if needed, but be efficient.

5. Always provide a final answer after using tools.

Example tool call:
{"tool": "web_search", "arguments": {"query": "current weather in San Francisco"}}

Now, how can I help you?`;
}

/**
 * Format tool results for LLM context
 */
function formatToolResults(toolCalls: Array<{ toolCall: ToolCall; result: ToolResult }>): string {
  const formatted = toolCalls.map(({ toolCall, result }) => {
    if (result.success) {
      return `Tool "${toolCall.name}" executed successfully:
${JSON.stringify(result.data, null, 2)}`;
    } else {
      return `Tool "${toolCall.name}" failed: ${result.error}`;
    }
  }).join('\n\n');
  
  return `Tool Execution Results:\n${formatted}\n\nPlease provide a helpful answer based on these results.`;
}

/**
 * Agent Orchestrator class
 */
export class AgentOrchestrator {
  private llmService: LocalModelService;
  private toolRegistry: ToolRegistry;
  private maxSteps: number;

  constructor(
    llmService: LocalModelService,
    toolRegistry: ToolRegistry,
    options: { maxSteps?: number } = {}
  ) {
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
    this.maxSteps = options.maxSteps || 3;
  }

  /**
   * Run agent with tool calling support
   */
  async run(
    query: string,
    conversationHistory: AgentMessage[] = [],
    options: AgentOptions = {}
  ): Promise<AgentResponse> {
    const systemPrompt = createSystemPrompt(this.toolRegistry);
    const maxSteps = options.maxSteps || this.maxSteps;
    const toolCalls: Array<{ toolCall: ToolCall; result: ToolResult }> = [];
    
    let currentQuery = query;
    let step = 0;
    let finalResponse = '';

    while (step < maxSteps) {
      step++;
      
      if (options.onStep) {
        options.onStep(step, step === 1 ? 'Analyzing query...' : 'Processing tool results...');
      }

      // Build prompt with conversation history and tool results
      let prompt = systemPrompt;
      
      // Add conversation history
      if (conversationHistory.length > 0) {
        const historyText = conversationHistory
          .slice(-5) // Last 5 messages for context
          .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
          .join('\n');
        prompt += `\n\nConversation History:\n${historyText}\n`;
      }
      
      // Add tool results if any
      if (toolCalls.length > 0) {
        prompt += `\n\n${formatToolResults(toolCalls)}\n\n`;
      }
      
      // Add current query
      prompt += `\n\nUser: ${currentQuery}\nAssistant:`;

      // Call LLM
      const response = await this.llmService.generate(prompt, {
        max_new_tokens: 800,
        temperature: 0.4,
        top_p: 0.9
      });

      // Check if response contains a tool call
      if (hasToolCall(response)) {
        const toolCall = parseToolCall(response);
        
        if (toolCall) {
          if (options.onToolCall) {
            options.onToolCall(toolCall);
          }

          // Execute tool
          const result = await this.toolRegistry.executeToolCall(toolCall);
          
          toolCalls.push({ toolCall, result });
          
          if (options.onToolResult) {
            options.onToolResult(toolCall, result);
          }

          // Continue loop with tool results
          currentQuery = `Based on the tool results, provide a helpful answer to: ${query}`;
          continue;
        }
      }

      // No tool call detected, this is the final response
      finalResponse = response;
      break;
    }

    return {
      message: finalResponse || 'I apologize, but I was unable to generate a response after multiple attempts.',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      steps: step
    };
  }

  /**
   * Run agent with streaming support
   */
  async runStreaming(
    query: string,
    conversationHistory: AgentMessage[] = [],
    options: AgentOptions & {
      onChunk?: (chunk: string) => void;
    } = {}
  ): Promise<AgentResponse> {
    const systemPrompt = createSystemPrompt(this.toolRegistry);
    const maxSteps = options.maxSteps || this.maxSteps;
    const toolCalls: Array<{ toolCall: ToolCall; result: ToolResult }> = [];
    
    let currentQuery = query;
    let step = 0;
    let finalResponse = '';
    let accumulatedResponse = '';

    while (step < maxSteps) {
      step++;
      
      if (options.onStep) {
        options.onStep(step, step === 1 ? 'Analyzing query...' : 'Processing tool results...');
      }

      // Build prompt
      let prompt = systemPrompt;
      
      if (conversationHistory.length > 0) {
        const historyText = conversationHistory
          .slice(-5)
          .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
          .join('\n');
        prompt += `\n\nConversation History:\n${historyText}\n`;
      }
      
      if (toolCalls.length > 0) {
        prompt += `\n\n${formatToolResults(toolCalls)}\n\n`;
      }
      
      prompt += `\n\nUser: ${currentQuery}\nAssistant:`;

      // Call LLM with streaming
      accumulatedResponse = '';
      const response = await this.llmService.generate(prompt, {
        max_new_tokens: 800,
        temperature: 0.4,
        top_p: 0.9,
        onChunk: (chunk: string) => {
          accumulatedResponse += chunk;
          if (options.onChunk) {
            options.onChunk(chunk);
          }
        }
      });

      // Check for tool call in accumulated response
      if (hasToolCall(accumulatedResponse)) {
        const toolCall = parseToolCall(accumulatedResponse);
        
        if (toolCall) {
          if (options.onToolCall) {
            options.onToolCall(toolCall);
          }

          const result = await this.toolRegistry.executeToolCall(toolCall);
          toolCalls.push({ toolCall, result });
          
          if (options.onToolResult) {
            options.onToolResult(toolCall, result);
          }

          currentQuery = `Based on the tool results, provide a helpful answer to: ${query}`;
          continue;
        }
      }

      finalResponse = accumulatedResponse || response;
      break;
    }

    return {
      message: finalResponse || 'I apologize, but I was unable to generate a response after multiple attempts.',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      steps: step
    };
  }
}
