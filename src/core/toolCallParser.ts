/**
 * Tool Call Parser
 * Detects and parses tool calls from LLM responses
 */

import type { ToolCall } from './AgentTools';

/**
 * Parse tool call from JSON format
 * Expected format: {"tool": "tool_name", "arguments": {...}} or {"tool_call": {...}}
 */
export function parseToolCallFromJSON(text: string): ToolCall | null {
  try {
    // Try to find JSON in the text
    const jsonMatch = text.match(/\{[\s\S]*"tool"[^}]*\}/) || 
                     text.match(/\{[\s\S]*"tool_call"[^}]*\}/) ||
                     text.match(/\{[\s\S]*"function"[^}]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Handle different formats
      if (parsed.tool) {
        return {
          name: parsed.tool,
          arguments: parsed.arguments || parsed.params || {},
          id: parsed.id
        };
      }
      
      if (parsed.tool_call) {
        return {
          name: parsed.tool_call.name || parsed.tool_call.tool,
          arguments: parsed.tool_call.arguments || parsed.tool_call.params || {},
          id: parsed.tool_call.id
        };
      }
      
      if (parsed.function) {
        return {
          name: parsed.function.name,
          arguments: JSON.parse(parsed.function.arguments || '{}'),
          id: parsed.id
        };
      }
    }
  } catch (error) {
    // JSON parsing failed, try other methods
  }
  
  return null;
}

/**
 * Parse tool call from text format
 * Looks for patterns like: CALL_TOOL(tool_name, {...}) or use_tool("tool_name", {...})
 */
export function parseToolCallFromText(text: string): ToolCall | null {
  // Pattern 1: CALL_TOOL(tool_name, {...})
  const callToolMatch = text.match(/CALL_TOOL\s*\(\s*["']?(\w+)["']?\s*,\s*(\{[\s\S]*?\})\s*\)/i);
  if (callToolMatch) {
    try {
      const args = JSON.parse(callToolMatch[2]);
      return {
        name: callToolMatch[1],
        arguments: args
      };
    } catch (error) {
      // Invalid JSON in arguments
    }
  }
  
  // Pattern 2: use_tool("tool_name", {...})
  const useToolMatch = text.match(/use_tool\s*\(\s*["'](\w+)["']\s*,\s*(\{[\s\S]*?\})\s*\)/i);
  if (useToolMatch) {
    try {
      const args = JSON.parse(useToolMatch[2]);
      return {
        name: useToolMatch[1],
        arguments: args
      };
    } catch (error) {
      // Invalid JSON in arguments
    }
  }
  
  // Pattern 3: Tool: tool_name\nArguments: {...}
  const toolPatternMatch = text.match(/Tool:\s*(\w+)\s*\nArguments:\s*(\{[\s\S]*?\})/i);
  if (toolPatternMatch) {
    try {
      const args = JSON.parse(toolPatternMatch[2]);
      return {
        name: toolPatternMatch[1],
        arguments: args
      };
    } catch (error) {
      // Invalid JSON in arguments
    }
  }
  
  return null;
}

/**
 * Parse tool call from code block format
 * Looks for ```json or ``` blocks with tool call
 */
export function parseToolCallFromCodeBlock(text: string): ToolCall | null {
  // Try to find code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      
      if (parsed.tool || parsed.tool_call || parsed.function) {
        return parseToolCallFromJSON(codeBlockMatch[1]);
      }
    } catch (error) {
      // Not valid JSON
    }
  }
  
  return null;
}

/**
 * Main function to parse tool call from LLM response
 * Tries multiple parsing strategies
 */
export function parseToolCall(response: string): ToolCall | null {
  if (!response || typeof response !== 'string') {
    return null;
  }
  
  // Try JSON format first (most reliable)
  const jsonResult = parseToolCallFromJSON(response);
  if (jsonResult) {
    return jsonResult;
  }
  
  // Try code block format
  const codeBlockResult = parseToolCallFromCodeBlock(response);
  if (codeBlockResult) {
    return codeBlockResult;
  }
  
  // Try text format (least reliable)
  const textResult = parseToolCallFromText(response);
  if (textResult) {
    return textResult;
  }
  
  return null;
}

/**
 * Check if response contains a tool call
 */
export function hasToolCall(response: string): boolean {
  if (!response) return false;
  
  // Quick checks for common patterns
  const patterns = [
    /"tool"\s*:/i,
    /"tool_call"\s*:/i,
    /"function"\s*:/i,
    /CALL_TOOL/i,
    /use_tool/i,
    /Tool:\s*\w+/i
  ];
  
  return patterns.some(pattern => pattern.test(response));
}
