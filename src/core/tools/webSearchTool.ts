/**
 * Web Search Tool
 * Supports multiple search providers: Tavily, Serper, Google Custom Search
 */

import { z } from 'zod';
import type { Tool, ToolResult } from '../AgentTools';

export type WebSearchProvider = 'tavily' | 'serper' | 'google';

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
    description: 'Search the web for current information. Use this when you need up-to-date information not available in the current page context. Returns a list of search results with titles, snippets, and URLs.',
    parameters: z.object({
      query: z.string().describe('The search query to look up on the web')
    }),
    execute: async ({ query }: { query: string }) => {
      console.log(`[WebSearchTool] Searching for: "${query}" using ${config.provider}`);

      switch (config.provider) {
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
