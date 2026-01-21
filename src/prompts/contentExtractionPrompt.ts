/**
 * Prompt for LLM-based content extraction
 * Used to identify the main content area of a web page
 */

export function createContentExtractionPrompt(htmlStructure: string, url: string): string {
  return `You are analyzing a web page to identify the main content area. Your task is to determine which HTML element contains the primary article/content (not navigation, footer, header, or ads).

HTML Structure (body children):
${htmlStructure}

URL: ${url}

Instructions:
1. Analyze the HTML structure above
2. Identify the element that contains the main article/content
3. Return ONLY a CSS selector that uniquely identifies this element
4. The selector should be specific enough to target the main content container
5. Prefer semantic selectors (main, article, [role="main"]) if available
6. If no clear main content, return the selector for the element with the most substantial text content

Return format: Just the CSS selector, nothing else. Example: "main" or "#content" or ".article-content" or "body > div:nth-child(2)"

IMPORTANT: Do NOT select iframes or elements inside iframes. Ignore chatbot widgets, ads, and third-party embeds.

CSS Selector:`;
}
