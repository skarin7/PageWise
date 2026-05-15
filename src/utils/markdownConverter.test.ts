import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, chunkToMarkdown } from './markdownConverter';

// htmlToMarkdown(el) iterates el.childNodes and converts each child node.
// The root element itself is never passed through the tag switch — only its children are.
// All tests therefore wrap the element under test in a <div> container.

function wrap(...nodes: (HTMLElement | string)[]): HTMLElement {
  const div = document.createElement('div');
  nodes.forEach(n => {
    if (typeof n === 'string') {
      div.innerHTML += n;
    } else {
      div.appendChild(n);
    }
  });
  return div;
}

function el(tag: string, html = '', attrs: Record<string, string> = {}): HTMLElement {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  e.innerHTML = html;
  return e;
}

// ─── htmlToMarkdown ────────────────────────────────────────────────────────

describe('htmlToMarkdown', () => {
  describe('headings', () => {
    it.each([
      [1, '# '],
      [2, '## '],
      [3, '### '],
      [4, '#### '],
      [5, '##### '],
      [6, '###### '],
    ])('converts h%i to the correct markdown prefix', (level, prefix) => {
      const md = htmlToMarkdown(wrap(el(`h${level}`, 'Hello')));
      expect(md).toContain(`${prefix}Hello`);
    });
  });

  describe('paragraphs', () => {
    it('wraps paragraph text with newlines', () => {
      const md = htmlToMarkdown(wrap(el('p', 'Some paragraph text')));
      expect(md).toContain('Some paragraph text');
    });

    it('skips empty paragraphs', () => {
      const md = htmlToMarkdown(wrap(el('p', '   ')));
      expect(md.trim()).toBe('');
    });
  });

  describe('inline formatting', () => {
    it('converts <strong> to **bold**', () => {
      const md = htmlToMarkdown(wrap(el('strong', 'bold')));
      expect(md).toBe('**bold**');
    });

    it('converts <b> to **bold**', () => {
      expect(htmlToMarkdown(wrap(el('b', 'bold')))).toBe('**bold**');
    });

    it('converts <em> to *italic*', () => {
      expect(htmlToMarkdown(wrap(el('em', 'italic')))).toBe('*italic*');
    });

    it('converts <i> to *italic*', () => {
      expect(htmlToMarkdown(wrap(el('i', 'italic')))).toBe('*italic*');
    });

    it('converts <code> to inline code', () => {
      expect(htmlToMarkdown(wrap(el('code', 'myVar')))).toBe('`myVar`');
    });
  });

  describe('code block', () => {
    it('converts <pre> to a fenced code block', () => {
      const md = htmlToMarkdown(wrap(el('pre', 'const x = 1;')));
      expect(md).toContain('```');
      expect(md).toContain('const x = 1;');
    });
  });

  describe('links', () => {
    it('converts an absolute href to [text](url)', () => {
      const a = el('a', 'Click here', { href: '/about' });
      expect(htmlToMarkdown(wrap(a))).toBe('[Click here](/about)');
    });

    it('strips anchor-only hrefs (#) and keeps just the text', () => {
      const a = el('a', 'Jump', { href: '#section' });
      expect(htmlToMarkdown(wrap(a))).toBe('Jump');
    });

    it('strips javascript: hrefs and keeps just the text', () => {
      const a = el('a', 'Noop', { href: 'javascript:void(0)' });
      expect(htmlToMarkdown(wrap(a))).toBe('Noop');
    });

    it('outputs just text when href is absent', () => {
      const a = el('a', 'Plain');
      expect(htmlToMarkdown(wrap(a))).toBe('Plain');
    });
  });

  describe('lists', () => {
    it('converts <ul> items to "- item" lines', () => {
      const ul = document.createElement('ul');
      ['Apple', 'Banana'].forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      });
      const md = htmlToMarkdown(wrap(ul));
      expect(md).toContain('- Apple');
      expect(md).toContain('- Banana');
    });

    it('converts <ol> items to numbered lines', () => {
      const ol = document.createElement('ol');
      ['First', 'Second'].forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        ol.appendChild(li);
      });
      const md = htmlToMarkdown(wrap(ol));
      expect(md).toContain('1. First');
      expect(md).toContain('2. Second');
    });

    it('skips empty list items', () => {
      const ul = document.createElement('ul');
      const li = document.createElement('li');
      li.textContent = '   ';
      ul.appendChild(li);
      expect(htmlToMarkdown(wrap(ul)).trim()).toBe('');
    });
  });

  describe('blockquote', () => {
    it('prepends > to blockquote content', () => {
      const bq = el('blockquote', 'Famous words');
      const md = htmlToMarkdown(wrap(bq));
      expect(md).toContain('> Famous words');
    });
  });

  describe('horizontal rule', () => {
    it('converts <hr> to ---', () => {
      const hr = document.createElement('hr');
      expect(htmlToMarkdown(wrap(hr))).toContain('---');
    });
  });

  describe('line break', () => {
    it('converts <br> to a newline when it is a direct child of the container', () => {
      // <br> is handled in processNode's switch, not in processElementContent.
      // It must appear as a direct child of the element passed to htmlToMarkdown.
      const container = document.createElement('div');
      container.appendChild(document.createTextNode('line1'));
      container.appendChild(document.createElement('br'));
      container.appendChild(document.createTextNode('line2'));
      const md = htmlToMarkdown(container);
      expect(md).toContain('\n');
    });
  });

  describe('tables', () => {
    it('converts a table with thead to markdown table format', () => {
      const table = document.createElement('table');
      table.innerHTML = `
        <thead><tr><th>Name</th><th>Age</th></tr></thead>
        <tbody><tr><td>Alice</td><td>30</td></tr></tbody>
      `;
      const md = htmlToMarkdown(wrap(table));
      expect(md).toContain('| Name | Age |');
      expect(md).toContain('| --- | --- |');
      expect(md).toContain('| Alice | 30 |');
    });

    it('escapes pipe characters inside table cells', () => {
      const table = document.createElement('table');
      table.innerHTML = `
        <thead><tr><th>Col</th></tr></thead>
        <tbody><tr><td>A | B</td></tr></tbody>
      `;
      const md = htmlToMarkdown(wrap(table));
      expect(md).toContain('A \\| B');
    });

    it('handles a table without thead', () => {
      const table = document.createElement('table');
      table.innerHTML = `<tbody><tr><td>Cell</td></tr></tbody>`;
      const md = htmlToMarkdown(wrap(table));
      expect(md).toContain('Cell');
    });
  });

  describe('images', () => {
    it('converts an img with alt and src to ![alt](src)', () => {
      const img = document.createElement('img');
      img.alt = 'Logo';
      img.src = '/logo.png';
      expect(htmlToMarkdown(wrap(img))).toContain('![Logo](/logo.png)');
    });

    it('skips images without alt text', () => {
      const img = document.createElement('img');
      img.src = '/logo.png';
      expect(htmlToMarkdown(wrap(img)).trim()).toBe('');
    });
  });

  describe('filtered elements', () => {
    it.each(['script', 'style', 'noscript', 'meta', 'link'])(
      'produces no output for <%s> elements when nested inside a container',
      tag => {
        const inner = el(tag, 'should not appear');
        expect(htmlToMarkdown(wrap(inner)).trim()).toBe('');
      },
    );
  });

  describe('whitespace normalisation', () => {
    it('collapses 3+ consecutive newlines to at most 2', () => {
      const div = wrap(el('h2', 'A'), el('h2', 'B'), el('h2', 'C'));
      const md = htmlToMarkdown(div);
      expect(md).not.toMatch(/\n{3,}/);
    });
  });
});

// ─── chunkToMarkdown ───────────────────────────────────────────────────────

describe('chunkToMarkdown', () => {
  it('returns metadata.markdown when available', () => {
    const chunk = { text: 'raw text', metadata: { markdown: '# Heading\nBody' } };
    expect(chunkToMarkdown(chunk)).toBe('# Heading\nBody');
  });

  it('falls back to chunk.text when no metadata.markdown', () => {
    const chunk = { text: 'plain text', metadata: {} };
    expect(chunkToMarkdown(chunk)).toBe('plain text');
  });

  it('falls back to chunk.text when metadata is undefined', () => {
    const chunk = { text: 'plain text' };
    expect(chunkToMarkdown(chunk as any)).toBe('plain text');
  });
});
