/**
 * Agent Tools Framework
 * Tool registry and base interfaces for agent tool calling
 */

import { z } from 'zod';
import { tool } from 'ai';

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Tool definition interface
 */
export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute: (args: any) => Promise<ToolResult>;
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
  id?: string;
}

/**
 * Tool registry for managing available tools
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * Register a tool
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool definitions for LLM prompt
   */
  getToolDefinitions(): string {
    const definitions = this.getAll().map(tool => {
      const schema = tool.parameters as z.ZodObject<any>;
      const shape = schema.shape || {};
      const params = Object.entries(shape)
        .map(([key, value]: [string, any]) => {
          const type = value._def?.typeName || 'string';
          const description = value._def?.description || '';
          return `  ${key}: ${type}${description ? ` - ${description}` : ''}`;
        })
        .join('\n');

      return `- ${tool.name}: ${tool.description}
  Parameters:
${params}`;
    });

    return definitions.join('\n\n');
  }

  /**
   * Execute a tool call
   */
  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.get(toolCall.name);
    
    if (!tool) {
      return {
        success: false,
        error: `Tool "${toolCall.name}" not found`
      };
    }

    try {
      // Validate parameters against schema
      const parsed = tool.parameters.parse(toolCall.arguments);
      
      // Execute tool
      const result = await tool.execute(parsed);
      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          error: `Invalid parameters: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        };
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

// Global tool registry instance
export const toolRegistry = new ToolRegistry();

/**
 * Convert ToolRegistry tools to AI SDK format
 */
export function convertToolsToAISDK(toolRegistry: ToolRegistry): Record<string, any> {
  const aiSdkTools: Record<string, any> = {};
  
  for (const toolDef of toolRegistry.getAll()) {
    aiSdkTools[toolDef.name] = tool({
      description: toolDef.description,
      parameters: toolDef.parameters,
      execute: async (args: any) => {
        const result = await toolDef.execute(args);
        if (result.success) {
          return result.data;
        } else {
          throw new Error(result.error || 'Tool execution failed');
        }
      }
    });
  }
  
  return aiSdkTools;
}
