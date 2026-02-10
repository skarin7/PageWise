/**
 * References lookup service for the Define feature.
 * Given a word, returns references from the knowledge base.
 * Used by the standalone REST server; validated with Zod.
 */

import { z } from 'zod';
import type { WordReference, ReferencesResponse } from '../types';

const WordInputSchema = z.object({
  word: z.string().min(1).max(200).trim(),
});

function log(level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>): void {
  const entry = { level, msg, ...data, ts: new Date().toISOString() };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

const MOCK_REFERENCES: Record<string, WordReference[]> = {
  example: [
    { title: 'Example - Wikipedia', url: 'https://en.wikipedia.org/wiki/Example', snippet: 'An example is a representation of something.' },
    { title: 'Example (programming)', url: 'https://en.wikipedia.org/wiki/Example_(programming)', snippet: 'In programming, an example is sample code or data.' },
  ],
  define: [
    { title: 'Define - Merriam-Webster', url: 'https://www.merriam-webster.com/dictionary/define', snippet: 'To state the meaning of a word.' },
  ],
  reference: [
    { title: 'Reference - Wikipedia', url: 'https://en.wikipedia.org/wiki/Reference', snippet: 'A reference is a relationship between objects.' },
  ],
};

/**
 * Look up all references for a given word.
 * Validates input with Zod; returns empty array for unknown words.
 */
export function lookupReferences(word: string): ReferencesResponse {
  const parsed = WordInputSchema.safeParse({ word });
  if (!parsed.success) {
    log('warn', 'references lookup invalid input', { word, errors: parsed.error.flatten() });
    return { word: word.trim(), references: [] };
  }
  const term = parsed.data.word.toLowerCase();
  log('info', 'references lookup', { term });
  const refs = MOCK_REFERENCES[term] ?? [];
  return { word: term, references: refs };
}
