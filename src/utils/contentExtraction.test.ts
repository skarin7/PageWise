import { describe, it, expect, beforeAll, vi } from 'vitest';
import { findMainContentByHeuristics, calculateTextDensity } from './contentExtraction';

// Make all elements appear visible in jsdom (default getBoundingClientRect returns 0x0)
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 100, height: 100, x: 0, y: 0, top: 0, left: 0, bottom: 100, right: 100, toJSON: () => ({}) }),
  });
});

function makeDoc(bodyHtml: string): Document {
  const doc = document.implementation.createHTMLDocument('Test');
  doc.body.innerHTML = bodyHtml;
  return doc;
}

// ─── calculateTextDensity ──────────────────────────────────────────────────

describe('calculateTextDensity', () => {
  it('returns 0 for an empty element', () => {
    const div = document.createElement('div');
    expect(calculateTextDensity(div)).toBe(0);
  });

  it('returns 1.0 for an element with no links', () => {
    const div = document.createElement('div');
    div.textContent = 'Plain text with no anchor tags whatsoever.';
    expect(calculateTextDensity(div)).toBe(1);
  });

  it('returns a lower value when link text makes up part of the total text', () => {
    const div = document.createElement('div');
    div.innerHTML = 'Some article text. <a href="/page">Click here for more information</a> and other details.';
    const density = calculateTextDensity(div);
    // Link text is "Click here for more information" — should reduce density below 1
    expect(density).toBeLessThan(1);
    expect(density).toBeGreaterThan(0);
  });

  it('returns a very low value when nearly all text is inside links', () => {
    const div = document.createElement('div');
    div.innerHTML = '<a href="/a">First link</a> <a href="/b">Second link</a> <a href="/c">Third link</a>';
    const density = calculateTextDensity(div);
    expect(density).toBeLessThan(0.5);
  });
});

// ─── findMainContentByHeuristics ──────────────────────────────────────────

describe('findMainContentByHeuristics', () => {
  it('returns null when document has no body', () => {
    const doc = document.implementation.createHTMLDocument('Empty');
    // Remove body to simulate edge case
    doc.body.remove();
    expect(findMainContentByHeuristics(doc as any)).toBeNull();
  });

  it('finds a <main> element containing substantial text', () => {
    const doc = makeDoc(`
      <nav>Site navigation links go here</nav>
      <main>
        <h1>Article Title</h1>
        <p>This is the main article content. It has paragraphs and headings and lots of useful text for the reader.</p>
        <p>A second paragraph with even more information about the topic being discussed in this article.</p>
      </main>
      <footer>Footer copyright text</footer>
    `);
    const result = findMainContentByHeuristics(doc);
    expect(result).not.toBeNull();
    // Should pick the main element or an element inside it (not nav or footer)
    if (result) {
      expect(result.tagName.toLowerCase()).not.toBe('nav');
      expect(result.tagName.toLowerCase()).not.toBe('footer');
    }
  });

  it('prefers an element with id="content" over a nav element', () => {
    const doc = makeDoc(`
      <nav id="nav">Navigation menu with many links to other pages throughout the site</nav>
      <div id="content">
        <h1>Page Title</h1>
        <p>This is the main content area of the page with lots of informative text.</p>
        <p>Additional paragraph expanding on the topic and providing more useful information.</p>
      </div>
    `);
    const result = findMainContentByHeuristics(doc);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.id).not.toBe('nav');
    }
  });

  it('falls back to body when no better candidate is found', () => {
    const doc = makeDoc(`<p>Short page with enough content to be considered substantial body text for testing purposes.</p>`);
    const result = findMainContentByHeuristics(doc);
    // Should not return null — falls back to body at minimum
    expect(result).not.toBeNull();
  });

  it('excludes <nav> elements (marked as unlikely content)', () => {
    const doc = makeDoc(`
      <nav>Home | About | Contact | Products | Services | Blog | FAQ | Login | Register</nav>
      <article>
        <h1>Main Heading</h1>
        <p>Significant article content that should be selected over the navigation element above.</p>
        <p>More content elaborating on the main topic of the article with useful information for readers.</p>
      </article>
    `);
    const result = findMainContentByHeuristics(doc);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.tagName.toLowerCase()).not.toBe('nav');
    }
  });

  it('handles a page that is entirely navigation links gracefully', () => {
    const doc = makeDoc(`
      <nav>
        <a href="/a">Link 1</a>
        <a href="/b">Link 2</a>
        <a href="/c">Link 3</a>
      </nav>
    `);
    // Should not throw — returns body or best available
    expect(() => findMainContentByHeuristics(doc)).not.toThrow();
  });
});
