/**
 * Heading hierarchy utilities
 */

import type { HeadingNode } from '../types';

/**
 * Build heading hierarchy tree from headings array
 */
export function buildHeadingHierarchy(headings: HTMLElement[]): HeadingNode[] {
  const tree: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  
  headings.forEach(heading => {
    const level = parseInt(heading.tagName.charAt(1));
    const text = heading.textContent?.trim() || '';
    const node: HeadingNode = {
      element: heading,
      level,
      text,
      children: [],
      contentStart: heading.nextElementSibling as HTMLElement || undefined
    };
    
    // Find parent in stack (pop until we find a parent with lower level)
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    
    if (stack.length === 0) {
      tree.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    
    stack.push(node);
  });
  
  return tree;
}

/**
 * Find next heading at same or higher level
 */
export function findNextHeading(heading: HTMLElement, container: HTMLElement): HTMLElement | null {
  const level = parseInt(heading.tagName.charAt(1));
  let current = heading.nextElementSibling;
  
  while (current && container.contains(current)) {
    if (current.tagName.match(/^H[1-6]$/)) {
      const nextLevel = parseInt(current.tagName.charAt(1));
      if (nextLevel <= level) {
        return current as HTMLElement;
      }
    }
    current = current.nextElementSibling;
  }
  
  return null;
}

/**
 * Get heading path (array of heading texts from root to current)
 */
export function getHeadingPath(heading: HTMLElement, headingTree: HeadingNode[]): string[] {
  const path: string[] = [];
  
  function findInTree(node: HeadingNode, target: HTMLElement, currentPath: string[]): boolean {
    const newPath = [...currentPath, node.text];
    
    if (node.element === target) {
      path.push(...newPath);
      return true;
    }
    
    for (const child of node.children) {
      if (findInTree(child, target, newPath)) {
        return true;
      }
    }
    
    return false;
  }
  
  for (const node of headingTree) {
    if (findInTree(node, heading, [])) {
      break;
    }
  }
  
  return path;
}

