/**
 * HTML to Markdown converter
 * Converts HTML elements to clean Markdown format (Crawl4AI-style)
 */

/**
 * Convert HTML element to Markdown
 */
export function htmlToMarkdown(element: HTMLElement): string {
  const markdown: string[] = [];
  
  function processNode(node: Node, depth: number = 0): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        markdown.push(text);
      }
      return;
    }
    
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    
    const el = node as HTMLElement;
    const tagName = el.tagName.toLowerCase();
    
    // Skip unwanted elements
    if (['script', 'style', 'noscript', 'meta', 'link'].includes(tagName)) {
      return;
    }
    
    switch (tagName) {
      case 'h1':
        markdown.push(`\n# ${getTextContent(el)}\n`);
        break;
      case 'h2':
        markdown.push(`\n## ${getTextContent(el)}\n`);
        break;
      case 'h3':
        markdown.push(`\n### ${getTextContent(el)}\n`);
        break;
      case 'h4':
        markdown.push(`\n#### ${getTextContent(el)}\n`);
        break;
      case 'h5':
        markdown.push(`\n##### ${getTextContent(el)}\n`);
        break;
      case 'h6':
        markdown.push(`\n###### ${getTextContent(el)}\n`);
        break;
      case 'p':
        const pText = processElementContent(el);
        if (pText.trim()) {
          markdown.push(`\n${pText}\n`);
        }
        break;
      case 'strong':
      case 'b':
        markdown.push(`**${getTextContent(el)}**`);
        break;
      case 'em':
      case 'i':
        markdown.push(`*${getTextContent(el)}*`);
        break;
      case 'code':
        markdown.push(`\`${getTextContent(el)}\``);
        break;
      case 'pre':
        markdown.push(`\n\`\`\`\n${getTextContent(el)}\n\`\`\`\n`);
        break;
      case 'a':
        const href = el.getAttribute('href') || '';
        const linkText = getTextContent(el);
        if (href && linkText) {
          // Skip navigation links
          if (!href.startsWith('#') && !href.startsWith('javascript:')) {
            markdown.push(`[${linkText}](${href})`);
          } else {
            markdown.push(linkText);
          }
        } else {
          markdown.push(linkText);
        }
        break;
      case 'ul':
      case 'ol':
        markdown.push('\n');
        processList(el, tagName === 'ol');
        markdown.push('\n');
        return; // Don't process children again
      case 'li':
        // Handled by processList
        break;
      case 'blockquote':
        const quoteText = processElementContent(el);
        if (quoteText.trim()) {
          markdown.push(`\n> ${quoteText.split('\n').join('\n> ')}\n`);
        }
        break;
      case 'hr':
        markdown.push('\n---\n');
        break;
      case 'br':
        markdown.push('\n');
        break;
      case 'table':
        markdown.push('\n');
        markdown.push(tableToMarkdown(el));
        markdown.push('\n');
        return; // Don't process children again
      case 'img':
        const alt = el.getAttribute('alt') || '';
        const src = el.getAttribute('src') || '';
        if (alt && src) {
          markdown.push(`![${alt}](${src})`);
        }
        break;
      default:
        // For other elements, process children
        Array.from(el.childNodes).forEach(child => processNode(child, depth + 1));
        break;
    }
  }
  
  function processElementContent(element: HTMLElement): string {
    const parts: string[] = [];
    Array.from(element.childNodes).forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.textContent || '');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as HTMLElement;
        const tag = childEl.tagName.toLowerCase();
        
        if (tag === 'a') {
          const href = childEl.getAttribute('href') || '';
          const text = getTextContent(childEl);
          if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            parts.push(`[${text}](${href})`);
          } else {
            parts.push(text);
          }
        } else if (tag === 'strong' || tag === 'b') {
          parts.push(`**${getTextContent(childEl)}**`);
        } else if (tag === 'em' || tag === 'i') {
          parts.push(`*${getTextContent(childEl)}*`);
        } else if (tag === 'code') {
          parts.push(`\`${getTextContent(childEl)}\``);
        } else {
          parts.push(getTextContent(childEl));
        }
      }
    });
    return parts.join(' ').trim();
  }
  
  function processList(list: HTMLElement, ordered: boolean): void {
    // Use direct children instead of :scope (better browser support)
    const items = Array.from(list.children).filter(child => child.tagName.toLowerCase() === 'li');
    items.forEach((item, index) => {
      const prefix = ordered ? `${index + 1}. ` : '- ';
      const itemText = processElementContent(item as HTMLElement);
      if (itemText.trim()) {
        markdown.push(`${prefix}${itemText}\n`);
      }
    });
  }
  
  function tableToMarkdown(table: HTMLElement): string {
    const rows: string[] = [];
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody') || table;
    
    // Process header
    if (thead) {
      const headerCells = Array.from(thead.querySelectorAll('tr:first-child th, tr:first-child td'));
      if (headerCells.length > 0) {
        const headers = headerCells.map(cell => getTextContent(cell as HTMLElement).trim());
        rows.push('| ' + headers.join(' | ') + ' |');
        rows.push('| ' + headers.map(() => '---').join(' | ') + ' |');
      }
    }
    
    // Process body rows
    const bodyRows = Array.from(tbody.querySelectorAll('tr'));
    bodyRows.forEach(row => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      if (cells.length > 0) {
        const cellTexts = cells.map(cell => getTextContent(cell as HTMLElement).trim().replace(/\|/g, '\\|'));
        rows.push('| ' + cellTexts.join(' | ') + ' |');
      }
    });
    
    return rows.join('\n');
  }
  
  function getTextContent(element: HTMLElement): string {
    return element.textContent?.trim() || '';
  }
  
  // Process the element
  Array.from(element.childNodes).forEach(child => processNode(child));
  
  // Clean up: remove excessive newlines, trim
  return markdown
    .join('')
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .trim();
}

/**
 * Convert chunk text to Markdown format
 */
export function chunkToMarkdown(chunk: { text: string; metadata?: any }): string {
  // If chunk already has markdown, return it
  if (chunk.metadata?.markdown) {
    return chunk.metadata.markdown;
  }
  
  // Otherwise, convert the text (which may contain HTML-like structure hints)
  // For now, return as-is since we're extracting text, not HTML
  // In future, we can enhance this to convert heading paths to markdown
  return chunk.text;
}

