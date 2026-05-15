import { describe, it, expect, beforeEach } from 'vitest';
import { buildHeadingHierarchy, findNextHeading, getHeadingPath } from './headingHierarchy';
import type { HeadingNode } from '../types';

function h(level: number, text: string): HTMLElement {
  const el = document.createElement(`h${level}`);
  el.textContent = text;
  return el;
}

function container(...children: HTMLElement[]): HTMLElement {
  const div = document.createElement('div');
  children.forEach(c => div.appendChild(c));
  return div;
}

// ─── buildHeadingHierarchy ─────────────────────────────────────────────────

describe('buildHeadingHierarchy', () => {
  it('returns an empty array for empty input', () => {
    expect(buildHeadingHierarchy([])).toEqual([]);
  });

  it('creates a flat list for a single heading', () => {
    const tree = buildHeadingHierarchy([h(1, 'Title')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].text).toBe('Title');
    expect(tree[0].level).toBe(1);
    expect(tree[0].children).toHaveLength(0);
  });

  it('nests h2 under h1', () => {
    const [h1, h2] = [h(1, 'Parent'), h(2, 'Child')];
    const tree = buildHeadingHierarchy([h1, h2]);
    expect(tree).toHaveLength(1);
    expect(tree[0].text).toBe('Parent');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].text).toBe('Child');
  });

  it('nests three levels deep: h1 > h2 > h3', () => {
    const headings = [h(1, 'L1'), h(2, 'L2'), h(3, 'L3')];
    const tree = buildHeadingHierarchy(headings);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].text).toBe('L3');
  });

  it('treats a higher-level heading after a lower-level one as a sibling (h2 then h1)', () => {
    // h2 comes first, then h1 — h1 cannot be a child of h2
    const tree = buildHeadingHierarchy([h(2, 'Section'), h(1, 'Chapter')]);
    expect(tree).toHaveLength(2);
    expect(tree[0].text).toBe('Section');
    expect(tree[1].text).toBe('Chapter');
  });

  it('treats consecutive same-level headings as siblings', () => {
    const tree = buildHeadingHierarchy([h(2, 'A'), h(2, 'B'), h(2, 'C')]);
    expect(tree).toHaveLength(3);
    expect(tree.map(n => n.text)).toEqual(['A', 'B', 'C']);
    tree.forEach(node => expect(node.children).toHaveLength(0));
  });

  it('correctly handles interleaved heading levels: h1 h2 h2 h3', () => {
    const [h1, h2a, h2b, h3] = [h(1, 'Root'), h(2, 'A'), h(2, 'B'), h(3, 'B-Sub')];
    const tree = buildHeadingHierarchy([h1, h2a, h2b, h3]);
    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.children).toHaveLength(2);
    expect(root.children[0].text).toBe('A');
    expect(root.children[0].children).toHaveLength(0);
    expect(root.children[1].text).toBe('B');
    expect(root.children[1].children).toHaveLength(1);
    expect(root.children[1].children[0].text).toBe('B-Sub');
  });

  it('handles a list starting with h3 (no parent h1/h2)', () => {
    const tree = buildHeadingHierarchy([h(3, 'X'), h(3, 'Y')]);
    expect(tree).toHaveLength(2);
    expect(tree[0].text).toBe('X');
    expect(tree[1].text).toBe('Y');
  });

  it('stores the original element reference on each node', () => {
    const el = h(1, 'Title');
    const tree = buildHeadingHierarchy([el]);
    expect(tree[0].element).toBe(el);
  });
});

// ─── findNextHeading ───────────────────────────────────────────────────────

describe('findNextHeading', () => {
  it('returns null when there are no following siblings', () => {
    const h2 = h(2, 'Only heading');
    const div = container(h2);
    expect(findNextHeading(h2, div)).toBeNull();
  });

  it('finds the next sibling heading at the same level', () => {
    const h2a = h(2, 'First');
    const h2b = h(2, 'Second');
    const div = container(h2a, document.createElement('p'), h2b);
    expect(findNextHeading(h2a, div)).toBe(h2b);
  });

  it('finds a higher-priority (lower-numbered) heading before reaching same level', () => {
    const h2 = h(2, 'Section');
    const h1 = h(1, 'Chapter');
    const div = container(h2, h1);
    expect(findNextHeading(h2, div)).toBe(h1);
  });

  it('skips lower-priority (higher-numbered) headings and keeps searching', () => {
    const h2 = h(2, 'Section');
    const h3 = h(3, 'Subsection');
    const h2b = h(2, 'Next section');
    const div = container(h2, h3, h2b);
    // h3 level=3 > level=2 → skip; h2b level=2 <= 2 → return
    expect(findNextHeading(h2, div)).toBe(h2b);
  });

  it('returns null for an h1 with no following h1 or higher', () => {
    const h1 = h(1, 'Title');
    const h2 = h(2, 'Subtitle');
    const div = container(h1, h2);
    // Only h2 follows, level=2 > 1, so nothing qualifies
    expect(findNextHeading(h1, div)).toBeNull();
  });

  it('does not traverse outside the container boundary', () => {
    const h2a = h(2, 'Inside');
    const innerDiv = container(h2a);
    const h2b = h(2, 'Outside');
    // h2b is a sibling of innerDiv, not inside it
    const outerDiv = container(innerDiv, h2b);
    expect(findNextHeading(h2a, innerDiv)).toBeNull();
  });
});

// ─── getHeadingPath ────────────────────────────────────────────────────────

describe('getHeadingPath', () => {
  it('returns empty array when heading is not in tree', () => {
    const el = h(1, 'Not in tree');
    const tree = buildHeadingHierarchy([h(1, 'Other')]);
    expect(getHeadingPath(el, tree)).toEqual([]);
  });

  it('returns single-element path for a root heading', () => {
    const el = h(1, 'Title');
    const tree = buildHeadingHierarchy([el]);
    expect(getHeadingPath(el, tree)).toEqual(['Title']);
  });

  it('returns full path for a nested heading', () => {
    const parent = h(1, 'Chapter');
    const child = h(2, 'Section');
    const tree = buildHeadingHierarchy([parent, child]);
    expect(getHeadingPath(child, tree)).toEqual(['Chapter', 'Section']);
  });

  it('returns three-level path for deeply nested heading', () => {
    const l1 = h(1, 'Root');
    const l2 = h(2, 'Branch');
    const l3 = h(3, 'Leaf');
    const tree = buildHeadingHierarchy([l1, l2, l3]);
    expect(getHeadingPath(l3, tree)).toEqual(['Root', 'Branch', 'Leaf']);
  });

  it('returns correct path when multiple children exist at same level', () => {
    const root = h(1, 'Root');
    const childA = h(2, 'A');
    const childB = h(2, 'B');
    const grandchild = h(3, 'B-Leaf');
    const tree = buildHeadingHierarchy([root, childA, childB, grandchild]);
    expect(getHeadingPath(grandchild, tree)).toEqual(['Root', 'B', 'B-Leaf']);
    expect(getHeadingPath(childA, tree)).toEqual(['Root', 'A']);
  });
});
