/**
 * Web Search Tool
 * Supports multiple search providers: Ollama, Tavily, Serper, Google Custom Search
 */

import { z } from 'zod';
import type { Tool, ToolResult } from '../AgentTools';

export type WebSearchProvider = 'ollama' | 'tavily' | 'serper' | 'google';

export interface WebSearchConfig {
  provider: WebSearchProvider;
  apiKey?: string;
}

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

/**
 * Search using Tavily API
 */
async function searchTavily(query: string, apiKey?: string): Promise<ToolResult> {
  if (!apiKey) {
    return {
      success: false,
      error: 'Tavily API key required'
    };
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        max_results: 5,
        search_depth: 'basic'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Tavily API error: ${response.status} ${errorText}`
      };
    }

    const data = await response.json();
    const results: SearchResult[] = (data.results || []).map((item: any) => ({
      title: item.title || '',
      snippet: item.content || item.snippet || '',
      url: item.url || ''
    }));

    return {
      success: true,
      data: {
        results,
        query,
        provider: 'tavily'
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tavily search failed'
    };
  }
}

/**
 * Search using Serper API
 */
async function searchSerper(query: string, apiKey?: string): Promise<ToolResult> {
  if (!apiKey) {
    return {
      success: false,
      error: 'Serper API key required'
    };
  }

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        q: query,
        num: 5
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Serper API error: ${response.status} ${errorText}`
      };
    }

    const data = await response.json();
    const results: SearchResult[] = (data.organic || []).map((item: any) => ({
      title: item.title || '',
      snippet: item.snippet || '',
      url: item.link || ''
    }));

    return {
      success: true,
      data: {
        results,
        query,
        provider: 'serper'
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Serper search failed'
    };
  }
}

/**
 * Search using Ollama's native web search API
 * Requires Ollama API key (get from https://ollama.com)
 */
async function searchOllama(query: string, apiKey?: string, maxResults: number = 5): Promise<ToolResult> {
  if (!apiKey) {
    return {
      success: false,
      error: 'Ollama API key required. Get one from https://ollama.com (free account required)'
    };
  }

  try {
    const response = await fetch('https://ollama.com/api/web_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query: query,
        max_results: Math.min(maxResults, 10) // Ollama API max is 10
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Ollama web search API error: ${response.status} ${errorText}`
      };
    }

    const data = await response.json();
    const results: SearchResult[] = (data.results || []).map((item: any) => ({
      title: item.title || '',
      snippet: item.content || item.snippet || '',
      url: item.url || ''
    }));

    return {
      success: true,
      data: {
        results,
        query,
        provider: 'ollama'
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Ollama web search failed'
    };
  }
}

/**
 * Search using Google Custom Search API
 */
async function searchGoogle(query: string, apiKey?: string, searchEngineId?: string): Promise<ToolResult> {
  if (!apiKey || !searchEngineId) {
    return {
      success: false,
      error: 'Google Custom Search API key and Search Engine ID required'
    };
  }

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=5`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Google Custom Search API error: ${response.status} ${errorText}`
      };
    }

    const data = await response.json();
    const results: SearchResult[] = (data.items || []).map((item: any) => ({
      title: item.title || '',
      snippet: item.snippet || '',
      url: item.link || ''
    }));

    return {
      success: true,
      data: {
        results,
        query,
        provider: 'google'
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Google search failed'
    };
  }
}

/**
 * Create web search tool
 */
export function createWebSearchTool(config: WebSearchConfig): Tool {
  return {
    name: 'web_search',
    description: `Search the web to retrieve current, up-to-date information from the internet.

IMPORTANT: Use this tool ONLY as a last resort. Always check the current page context first before using this tool.

Use this tool ONLY when:
- The information is NOT available in the current page context provided to you
- The information is NOT in your training knowledge
- Requires real-time or frequently updated data (current events, news, prices, weather, etc.)
- May be more recent than your training data cutoff
- You are uncertain whether your training knowledge is current enough AND the information is not in the page context

This tool is particularly useful for:
- Information that is clearly NOT in the current page context
- Current events and recent news not mentioned on the page
- Information that changes frequently (stock prices, sports scores, weather)
- Recent developments in any field
- Data that may have been updated since your training

Do NOT use this tool for:
- Information clearly available in the current page context (ALWAYS check page context first)
- Well-established general knowledge (scientific facts, historical dates, definitions)
- Questions about historical events that are well-documented
- General knowledge questions where you're highly confident in your training data

PRIORITY: If the user is asking about something on the current page (e.g., company information when on a company page), check the page context first. Only use web search if the specific information is NOT found in the page context.

The tool returns a list of search results with titles, snippets, and URLs from the web. Use these results to provide accurate, current information to the user.`,
    parameters: z.object({
      query: z.string().describe('A focused search query that captures the information need. Should be specific enough to retrieve relevant results but comprehensive enough to find complete information. Formulate the query to match how people would search for this information on the web.')
    }),
    execute: async ({ query }: { query: string }) => {
      console.log(`[WebSearchTool] Searching for: "${query}" using ${config.provider}`);

      switch (config.provider) {
        case 'ollama':
          return searchOllama(query, config.apiKey);
        case 'tavily':
          return searchTavily(query, config.apiKey);
        case 'serper':
          return searchSerper(query, config.apiKey);
        case 'google':
          // For Google, we'd need searchEngineId too, but keeping it simple for now
          // Could extend config later
          return searchGoogle(query, config.apiKey);
        default:
          return {
            success: false,
            error: `Unknown search provider: ${config.provider}`
          };
      }
    }
  };
}
