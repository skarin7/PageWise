import { describe, it, expect } from 'vitest';
import {
  getChatPromptTemplates,
  getContextualPromptTemplates,
  type ChatPromptTemplate,
} from '../chatPromptTemplates';

describe('chatPromptTemplates', () => {
  describe('getChatPromptTemplates', () => {
    it('returns a non-empty array', () => {
      const templates = getChatPromptTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
    });

    it('each template has id, label, and prompt', () => {
      const templates = getChatPromptTemplates();
      templates.forEach((t: ChatPromptTemplate) => {
        expect(t).toHaveProperty('id');
        expect(typeof t.id).toBe('string');
        expect(t.id.length).toBeGreaterThan(0);
        expect(t).toHaveProperty('label');
        expect(typeof t.label).toBe('string');
        expect(t.label.length).toBeGreaterThan(0);
        expect(t).toHaveProperty('prompt');
        expect(typeof t.prompt).toBe('string');
        expect(t.prompt.length).toBeGreaterThan(0);
      });
    });

    it('ids are unique', () => {
      const templates = getChatPromptTemplates();
      const ids = templates.map((t) => t.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it('returns a new array each time (no mutation)', () => {
      const a = getChatPromptTemplates();
      const b = getChatPromptTemplates();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('getContextualPromptTemplates', () => {
    it('returns full-sentence prompts (not just keywords)', () => {
      const templates = getContextualPromptTemplates([], {});
      expect(templates.length).toBeGreaterThan(0);
      templates.forEach((t) => {
        expect(t.prompt).toBe(t.label);
        expect(t.prompt.length).toBeGreaterThan(15);
        expect(t.prompt.trim().endsWith('?') || t.prompt.trim().endsWith('.')).toBe(true);
      });
    });

    it('with empty history and empty context returns generic templates', () => {
      const templates = getContextualPromptTemplates([], {});
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.length).toBeLessThanOrEqual(6);
    });

    it('with jira-like URL includes jira-style prompts', () => {
      const templates = getContextualPromptTemplates([], {
        url: 'https://company.atlassian.net/jira/software/projects/X/issues/123',
      });
      const prompts = templates.map((t) => t.prompt);
      const hasJiraStyle = prompts.some(
        (p) =>
          p.includes('similar') ||
          p.includes('improve') ||
          p.includes('work on next') ||
          p.includes('Jira')
      );
      expect(hasJiraStyle).toBe(true);
    });

    it('when user already asked about summary, avoids duplicate summarize suggestion', () => {
      const withSummary = getContextualPromptTemplates(
        [{ role: 'user', content: 'Can you summarize this page?' }],
        {}
      );
      const summarizeTitles = withSummary.filter((t) =>
        t.prompt.toLowerCase().includes('summarize this page in a few')
      );
      expect(summarizeTitles.length).toBe(0);
    });

    it('each template has id, label, and prompt', () => {
      const templates = getContextualPromptTemplates([], { title: 'Doc', url: 'https://example.com' });
      templates.forEach((t: ChatPromptTemplate) => {
        expect(t).toHaveProperty('id');
        expect(t).toHaveProperty('label');
        expect(t).toHaveProperty('prompt');
        expect(typeof t.prompt).toBe('string');
        expect(t.prompt.length).toBeGreaterThan(0);
      });
    });
  });
});
