/**
 * DOM helper utilities
 */

/**
 * Get XPath for an element
 */
export function getXPath(element: HTMLElement): string {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }
  
  const parts: string[] = [];
  let current: Node | null = element;
  
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const el = current as HTMLElement;
    let index = 1;
    let sibling = el.previousElementSibling;
    
    while (sibling) {
      if (sibling.nodeName === el.nodeName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }
    
    const tagName = el.nodeName.toLowerCase();
    parts.unshift(`${tagName}[${index}]`);
    current = el.parentNode;
  }
  
  return '/' + parts.join('/');
}

/**
 * Get CSS selector for an element (more reliable than XPath)
 */
export function getCssSelector(element: HTMLElement): string {
  if (element.id) {
    return `#${element.id}`;
  }
  
  const parts: string[] = [];
  let current: HTMLElement | null = element;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    
    if (current.className) {
      const classes = current.className
        .split(' ')
        .filter(c => c.trim())
        .map(c => `.${c.trim().replace(/\s/g, '\\ ')}`)
        .join('');
      if (classes) {
        selector += classes;
      }
    }
    
    // Add nth-child if needed for uniqueness
    const siblings = Array.from(current.parentElement?.children || [])
      .filter(el => el.tagName === current!.tagName);
    
    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      selector += `:nth-of-type(${index})`;
    }
    
    parts.unshift(selector);
    current = current.parentElement;
  }
  
  return parts.join(' > ');
}

/**
 * Check if element is visible
 */
export function isVisible(element: HTMLElement): boolean {
  if (!element) return false;
  
  const style = window.getComputedStyle(element);
  
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  
  // Check if element has dimensions
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  
  return true;
}

/**
 * Extract text content, ignoring script/style/nav elements
 */
export function extractTextContent(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  
  // Remove unwanted elements
  clone.querySelectorAll('script, style, nav, [data-rag-ignore]').forEach(el => el.remove());
  
  // Remove links that are just navigation
  clone.querySelectorAll('a[href^="#"], a[href*="javascript:"]').forEach(el => el.remove());
  
  return clone.textContent?.trim() || '';
}

/**
 * Remove link text and navigation elements
 */
export function removeLinks(text: string): string {
  return text.replace(/\b(View More|Learn More|Read More|See More|Read more|Learn more)\b/gi, '').trim();
}

