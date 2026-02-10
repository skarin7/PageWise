/**
 * Parse references from Define/knowledge-base API response.
 * Tolerates malformed data and returns a safe array of WordReference.
 */

import type { WordReference } from '../types';

/**
 * Parse API response (e.g. from GET /references) into a list of WordReference.
 * Returns empty array for null, non-object, or missing/invalid references.
 */
export function parseReferencesFromApiResponse(data: unknown): WordReference[] {
  if (data == null || typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;
  const refs = obj.references;
  if (!Array.isArray(refs)) return [];
  const out: WordReference[] = [];
  for (const item of refs) {
    if (item == null || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title : '';
    const url = typeof r.url === 'string' ? r.url : '';
    if (!url) continue;
    out.push({
      title: title || url,
      url,
      snippet: typeof r.snippet === 'string' ? r.snippet : undefined,
    });
  }
  return out;
}
