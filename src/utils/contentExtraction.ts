/**
 * Content extraction heuristics (Crawl4AI/Readability-style)
 * Inspired by Mozilla Readability and Crawl4AI's content extraction
 */

/**
 * Check if element should be removed (negative indicators)
 */
function isUnlikelyContent(element: HTMLElement): boolean {
  const unlikelySelectors = [
    'nav', 'footer', 'header', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.nav', '.navigation', '.menu', '.sidebar',
    '.footer', '.header', '.advertisement', '.ads',
    '[id*="nav"]', '[id*="menu"]', '[id*="sidebar"]',
    '[id*="footer"]', '[id*="header"]', '[id*="ad"]',
    '[class*="nav"]', '[class*="menu"]', '[class*="sidebar"]',
    '[class*="footer"]', '[class*="header"]', '[class*="ad-"]',
    '[class*="advertisement"]', '[class*="promo"]'
  ];
  
  const tagName = element.tagName.toLowerCase();
  const id = element.id || '';
  const className = element.className || '';
  
  // Check tag name
  if (['nav', 'footer', 'header', 'aside', 'script', 'style', 'noscript'].includes(tagName)) {
    return true;
  }
  
  // Check role
  const role = element.getAttribute('role');
  if (role && ['navigation', 'banner', 'contentinfo', 'complementary'].includes(role)) {
    return true;
  }
  
  // Check selectors
  for (const selector of unlikelySelectors) {
    if (element.matches(selector)) {
      return true;
    }
  }
  
  // Check id/class patterns
  const idClass = (id + ' ' + className).toLowerCase();
  if (idClass.includes('nav') || idClass.includes('menu') || 
      idClass.includes('sidebar') || idClass.includes('footer') ||
      idClass.includes('header') || idClass.includes('ad-') ||
      idClass.includes('advertisement') || idClass.includes('promo')) {
    return true;
  }
  
  return false;
}

/**
 * Check if element is likely to be main content (positive indicators)
 */
function isLikelyContent(element: HTMLElement): boolean {
  const likelySelectors = [
    'main', 'article', '[role="main"]', '[role="article"]',
    '[id*="content"]', '[id*="main"]', '[id*="post"]', '[id*="article"]',
    '[class*="content"]', '[class*="main"]', '[class*="post"]',
    '[class*="article"]', '[class*="entry"]', '[class*="text"]'
  ];
  
  const tagName = element.tagName.toLowerCase();
  const id = element.id || '';
  const className = element.className || '';
  
  // Check semantic tags
  if (['main', 'article'].includes(tagName)) {
    return true;
  }
  
  // Check role
  const role = element.getAttribute('role');
  if (role && ['main', 'article'].includes(role)) {
    return true;
  }
  
  // Check selectors
  for (const selector of likelySelectors) {
    if (element.matches(selector)) {
      return true;
    }
  }
  
  // Check id/class patterns
  const idClass = (id + ' ' + className).toLowerCase();
  if (idClass.includes('content') || idClass.includes('main') ||
      idClass.includes('post') || idClass.includes('article') ||
      idClass.includes('entry') || idClass.includes('text')) {
    return true;
  }
  
  return false;
}

/**
 * Calculate content score for an element (Readability-style)
 */
function calculateContentScore(element: HTMLElement): number {
  let score = 0;
  const text = element.textContent || '';
  const textLength = text.trim().length;
  
  if (textLength === 0) return 0;
  
  // Count different content elements
  const paragraphs = element.querySelectorAll('p').length;
  const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
  const lists = element.querySelectorAll('ul, ol').length;
  const links = element.querySelectorAll('a').length;
  const linkTextLength = Array.from(element.querySelectorAll('a'))
    .reduce((sum, a) => sum + (a.textContent?.trim().length || 0), 0);
  
  // Positive scoring
  score += paragraphs * 3; // Paragraphs are good
  score += headings * 5; // Headings are very good
  score += lists * 3; // Lists are good
  score += textLength / 100; // More text is better (scaled)
  
  // Negative scoring
  score -= links * 2; // Too many links is bad
  score -= (linkTextLength / textLength) * 100; // High link-to-text ratio is bad
  
  // Boost for likely content indicators
  if (isLikelyContent(element)) {
    score += 25;
  }
  
  // Penalty for unlikely content indicators
  if (isUnlikelyContent(element)) {
    score -= 50;
  }
  
  // Penalty for very short content
  if (textLength < 25) {
    score -= 20;
  }
  
  // Penalty for very high link density
  const linkDensity = linkTextLength / textLength;
  if (linkDensity > 0.5) {
    score -= 30;
  }
  
  return score;
}

/**
 * Find main content area using improved heuristics (Crawl4AI/Readability-style)
 * This recursively searches for the best content candidate
 */
export function findMainContentByHeuristics(document: Document): HTMLElement | null {
  const body = document.body;
  if (!body) return null;
  
  // First, try direct children of body
  let candidates: HTMLElement[] = Array.from(body.children) as HTMLElement[];
  
  // Filter out unlikely candidates
  candidates = candidates.filter(candidate => {
    if (!isVisible(candidate)) return false;
    if (isUnlikelyContent(candidate)) return false;
    return true;
  });
  
  // If we have likely content candidates, prioritize them
  const likelyCandidates = candidates.filter(c => isLikelyContent(c));
  if (likelyCandidates.length > 0) {
    candidates = likelyCandidates;
  }
  
  // Score all candidates
  const scoredCandidates = candidates.map(candidate => ({
    element: candidate,
    score: calculateContentScore(candidate)
  }));
  
  // Sort by score (highest first)
  scoredCandidates.sort((a, b) => b.score - a.score);
  
  // If we have a clear winner (score > 0 and significantly higher than others)
  if (scoredCandidates.length > 0) {
    const best = scoredCandidates[0];
    
    // If best score is positive and much better than second, use it
    if (best.score > 0 && 
        (scoredCandidates.length === 1 || best.score > scoredCandidates[1].score * 1.5)) {
      console.log(`[ContentExtraction] Found main content with score ${best.score.toFixed(2)}:`, best.element.tagName);
      return best.element;
    }
    
    // Otherwise, recursively search within the best candidate
    if (best.score > 0) {
      const recursiveResult = findMainContentRecursive(best.element);
      if (recursiveResult) {
        return recursiveResult;
      }
      return best.element;
    }
  }
  
  // Fallback: Recursively search body children
  for (const candidate of candidates) {
    const recursiveResult = findMainContentRecursive(candidate);
    if (recursiveResult) {
      return recursiveResult;
    }
  }
  
  // Last resort: Check if body itself has substantial content
  const bodyScore = calculateContentScore(body);
  if (bodyScore > 0 || (body.textContent || '').trim().length > 500) {
    console.log(`[ContentExtraction] Using body as main content (score: ${bodyScore.toFixed(2)})`);
    return body;
  }
  
  // If body doesn't have content, try to find the largest content container
  const allElements = Array.from(body.querySelectorAll('*')) as HTMLElement[];
  const scoredElements = allElements
    .filter(el => {
      if (!isVisible(el)) return false;
      if (isUnlikelyContent(el)) return false;
      const text = (el.textContent || '').trim();
      return text.length > 200; // Must have substantial text
    })
    .map(el => ({
      element: el,
      score: calculateContentScore(el)
    }))
    .sort((a, b) => b.score - a.score);
  
  if (scoredElements.length > 0 && scoredElements[0].score > 0) {
    console.log(`[ContentExtraction] Found main content via deep search (score: ${scoredElements[0].score.toFixed(2)})`);
    return scoredElements[0].element;
  }
  
  // Final fallback: return body
  console.log('[ContentExtraction] Using body as final fallback');
  return body;
}

/**
 * Recursively search for main content within an element
 */
function findMainContentRecursive(element: HTMLElement, depth: number = 0): HTMLElement | null {
  // Limit recursion depth
  if (depth > 3) return null;
  
  // Skip if unlikely content
  if (isUnlikelyContent(element)) return null;
  
  // Check if this element itself is good content
  const score = calculateContentScore(element);
  if (score > 20 && isLikelyContent(element)) {
    return element;
  }
  
  // Search children
  const children = Array.from(element.children) as HTMLElement[];
  const validChildren = children.filter(child => {
    if (!isVisible(child)) return false;
    if (isUnlikelyContent(child)) return false;
    return true;
  });
  
  if (validChildren.length === 0) {
    // No valid children, check if this element has good content
    if (score > 10 && (element.textContent || '').trim().length > 100) {
      return element;
    }
    return null;
  }
  
  // Score children and find best
  const scoredChildren = validChildren.map(child => ({
    element: child,
    score: calculateContentScore(child)
  }));
  
  scoredChildren.sort((a, b) => b.score - a.score);
  
  // Try best child recursively
  if (scoredChildren[0].score > 0) {
    const recursiveResult = findMainContentRecursive(scoredChildren[0].element, depth + 1);
    if (recursiveResult) {
      return recursiveResult;
    }
    
    // If recursive search didn't find better, use this child if score is good
    if (scoredChildren[0].score > 15) {
      return scoredChildren[0].element;
    }
  }
  
  // If no good child found, check if parent is good enough
  if (score > 10 && (element.textContent || '').trim().length > 100) {
    return element;
  }
  
  return null;
}

// Import isVisible from domHelpers
import { isVisible } from './domHelpers';

/**
 * Calculate text density for an element
 */
export function calculateTextDensity(element: HTMLElement): number {
  const text = element.textContent || '';
  const links = element.querySelectorAll('a').length;
  const textLength = text.length;
  const linkLength = Array.from(element.querySelectorAll('a'))
    .reduce((sum, a) => sum + (a.textContent?.length || 0), 0);
  
  if (textLength === 0) return 0;
  
  return (textLength - linkLength * 2) / textLength;
}

