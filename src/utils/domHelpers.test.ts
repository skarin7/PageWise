import { describe, it, expect, beforeAll } from 'vitest';
import { getXPath, getCssSelector, extractTextContent, removeLinks } from './domHelpers';

// Make all elements appear as visible in jsdom
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 100, height: 100, x: 0, y: 0, top: 0, left: 0, bottom: 100, right: 100, toJSON: () => ({}) }),
  });
});

// ─── getXPath ──────────────────────────────────────────────────────────────

describe('getXPath', () => {
  it('returns an id-based xpath when element has an id', () => {
    const div = document.createElement('div');
    div.id = 'main';
    expect(getXPath(div)).toBe('//*[@id="main"]');
  });

  it('returns a positional xpath for an element without id', () => {
    const parent = document.createElement('div');
    const child = document.createElement('p');
    parent.appendChild(child);
    document.body.appendChild(parent);
    const xpath = getXPath(child);
    expect(xpath).toMatch(/\/p\[\d+\]$/);
    parent.remove();
  });

  it('includes sibling index when multiple same-tag siblings exist', () => {
    const parent = document.createElement('ul');
    const li1 = document.createElement('li');
    const li2 = document.createElement('li');
    parent.appendChild(li1);
    parent.appendChild(li2);
    document.body.appendChild(parent);
    const xpath2 = getXPath(li2);
    expect(xpath2).toContain('li[2]');
    parent.remove();
  });
});

// ─── getCssSelector ────────────────────────────────────────────────────────

describe('getCssSelector', () => {
  it('returns an id selector when element has an id', () => {
    const div = document.createElement('div');
    div.id = 'hero';
    expect(getCssSelector(div)).toBe('#hero');
  });

  it('includes class names in the selector', () => {
    const div = document.createElement('div');
    div.className = 'card featured';
    document.body.appendChild(div);
    const sel = getCssSelector(div);
    expect(sel).toContain('.card');
    div.remove();
  });

  it('appends nth-of-type when multiple same-tag siblings exist', () => {
    const parent = document.createElement('section');
    const d1 = document.createElement('div');
    const d2 = document.createElement('div');
    parent.appendChild(d1);
    parent.appendChild(d2);
    document.body.appendChild(parent);
    const sel = getCssSelector(d2);
    expect(sel).toContain(':nth-of-type(2)');
    parent.remove();
  });
});

// ─── extractTextContent ────────────────────────────────────────────────────

describe('extractTextContent', () => {
  it('returns the text of a simple element', () => {
    const p = document.createElement('p');
    p.textContent = 'Hello world';
    expect(extractTextContent(p)).toBe('Hello world');
  });

  it('strips <script> and <style> tags from output', () => {
    const div = document.createElement('div');
    div.innerHTML = 'Visible <script>hidden()</script><style>.x{color:red}</style> text';
    const text = extractTextContent(div);
    expect(text).not.toContain('hidden');
    expect(text).not.toContain('.x');
    expect(text).toContain('Visible');
  });

  it('strips <nav> elements from output', () => {
    const div = document.createElement('div');
    div.innerHTML = '<nav>Menu items</nav>Article content here';
    expect(extractTextContent(div)).not.toContain('Menu items');
    expect(extractTextContent(div)).toContain('Article content');
  });

  it('removes anchor-only and javascript: links', () => {
    const div = document.createElement('div');
    div.innerHTML = 'Content <a href="#top">Back to top</a> more <a href="javascript:void(0)">Click</a>';
    const text = extractTextContent(div);
    expect(text).not.toContain('Back to top');
    expect(text).not.toContain('Click');
    expect(text).toContain('Content');
  });

  it('returns empty string for an empty element', () => {
    expect(extractTextContent(document.createElement('div'))).toBe('');
  });
});

// ─── removeLinks ──────────────────────────────────────────────────────────

describe('removeLinks', () => {
  it('strips "View More" from text', () => {
    expect(removeLinks('Article content View More')).not.toContain('View More');
  });

  it('strips "Read More" case-insensitively', () => {
    expect(removeLinks('Some text Read more details')).not.toContain('Read more');
    expect(removeLinks('Some text READ MORE')).not.toContain('READ MORE');
  });

  it('strips "Learn More" from text', () => {
    expect(removeLinks('Our product Learn More about it')).not.toContain('Learn More');
  });

  it('preserves text that does not contain any noise phrase', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    expect(removeLinks(text)).toBe(text);
  });

  it('trims leading and trailing whitespace after removal', () => {
    const result = removeLinks('  Read More  ');
    expect(result).toBe('');
  });
});
