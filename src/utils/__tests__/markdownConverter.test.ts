/**
 * Unit tests for markdownConverter
 */

import { describe, it, expect } from 'vitest';
import { chunkToMarkdown, htmlToMarkdown } from '../markdownConverter';

describe('chunkToMarkdown', () => {
  it('returns metadata.markdown when present', () => {
    const chunk = {
      text: 'Plain text',
      metadata: { markdown: '# Title\n\nParagraph with **bold**.' },
    };
    expect(chunkToMarkdown(chunk)).toBe('# Title\n\nParagraph with **bold**.');
  });

  it('returns chunk.text when metadata.markdown is absent', () => {
    const chunk = { text: 'Just plain text', metadata: {} };
    expect(chunkToMarkdown(chunk)).toBe('Just plain text');
  });

  it('returns chunk.text when metadata is undefined', () => {
    const chunk = { text: 'No metadata' };
    expect(chunkToMarkdown(chunk)).toBe('No metadata');
  });
});

describe('htmlToMarkdown', () => {
  it('converts a simple paragraph to markdown', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Hello world</p>';
    expect(htmlToMarkdown(div)).toContain('Hello world');
  });

  it('converts headings to markdown', () => {
    const div = document.createElement('div');
    div.innerHTML = '<h1>Title</h1><h2>Subtitle</h2>';
    const md = htmlToMarkdown(div);
    expect(md).toMatch(/#\s*Title/);
    expect(md).toMatch(/##\s*Subtitle/);
  });

  it('converts bold and italic', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p><strong>bold</strong> and <em>italic</em></p>';
    const md = htmlToMarkdown(div);
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
  });

  it('skips script and style elements', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Visible</p><script>alert(1)</script><style>.x{}</style>';
    const md = htmlToMarkdown(div);
    expect(md).toContain('Visible');
    expect(md).not.toContain('alert');
    expect(md).not.toContain('.x{}');
  });

  it('converts links to markdown format', () => {
    const div = document.createElement('div');
    div.innerHTML = '<a href="https://example.com">Example</a>';
    const md = htmlToMarkdown(div);
    expect(md).toContain('[Example](https://example.com)');
  });
});
