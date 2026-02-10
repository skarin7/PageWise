/**
 * Contextual prompt templates for the sidebar chat.
 * Generated from user chat history and page context; full-sentence suggestions.
 */

export interface ChatPromptTemplate {
  id: string;
  label: string;
  prompt: string;
}

export interface PageContext {
  title?: string;
  url?: string;
}

export interface ChatHistoryEntry {
  role: string;
  content: string;
}

/** Full-sentence templates with optional context hint and topic to avoid if already asked */
interface TemplateDef {
  id: string;
  prompt: string;
  contextHint?: 'jira' | 'confluence' | 'generic';
  avoidIfTopic?: string[]; // if any user message matches (substring), skip this template
}

const POOL: TemplateDef[] = [
  // Generic – always useful
  { id: 'summarize', prompt: 'Summarize this page in a few short paragraphs.', contextHint: 'generic', avoidIfTopic: ['summar', 'summary'] },
  { id: 'key-points', prompt: 'What are the main key points on this page?', contextHint: 'generic', avoidIfTopic: ['key point', 'main point'] },
  { id: 'main-idea', prompt: 'Explain the main idea of this page in simple terms.', contextHint: 'generic', avoidIfTopic: ['main idea', 'main point'] },
  { id: 'definitions', prompt: 'List and explain any important terms or definitions on this page.', contextHint: 'generic', avoidIfTopic: ['definition', 'term'] },
  { id: 'important-facts', prompt: 'List the most important facts from this page.', contextHint: 'generic', avoidIfTopic: ['fact', 'important'] },
  { id: 'action-items', prompt: 'Are there any action items, steps, or recommendations on this page? List them.', contextHint: 'generic', avoidIfTopic: ['action', 'step', 'recommend'] },
  { id: 'what-about', prompt: 'What is this page about?', contextHint: 'generic', avoidIfTopic: ['about', 'summar'] },
  { id: 'takeaways', prompt: 'What are the main takeaways?', contextHint: 'generic', avoidIfTopic: ['takeaway', 'key point'] },
  // Jira / issue-tracking style (from sample UI)
  { id: 'similar-issues', prompt: 'Are there any similar Jira issues to this one?', contextHint: 'jira', avoidIfTopic: ['similar', 'jira issue'] },
  { id: 'improve-description', prompt: 'How could I improve the description?', contextHint: 'jira', avoidIfTopic: ['improve', 'description'] },
  { id: 'work-on-next', prompt: 'What should I work on next?', contextHint: 'jira', avoidIfTopic: ['next', 'work on'] },
  { id: 'related-tickets', prompt: 'What related tickets or dependencies are mentioned?', contextHint: 'jira' },
  { id: 'acceptance-criteria', prompt: 'What are the acceptance criteria or requirements?', contextHint: 'jira' },
  // Confluence / docs
  { id: 'sections', prompt: 'Break down this page into sections and summarize each.', contextHint: 'confluence', avoidIfTopic: ['section', 'break down'] },
  { id: 'who-for', prompt: 'Who is this page for and what problem does it solve?', contextHint: 'generic' },
];

const MAX_TEMPLATES = 6;
const GENERIC_FALLBACK_IDS = ['summarize', 'key-points', 'main-idea', 'what-about', 'important-facts', 'action-items'];

function detectContext(pageContext: PageContext): ('jira' | 'confluence' | 'generic')[] {
  const url = (pageContext.url ?? '').toLowerCase();
  const title = (pageContext.title ?? '').toLowerCase();
  const hints: ('jira' | 'confluence' | 'generic')[] = ['generic'];
  if (/jira|atlassian|\.jira\.|issues?\./.test(url) || /jira|issue|ticket|bug|story/.test(title)) {
    hints.push('jira');
  }
  if (/confluence|wiki|docs?\./.test(url) || /confluence|wiki|documentation/.test(title)) {
    hints.push('confluence');
  }
  return hints;
}

function userMessagesCoverTopic(chatHistory: ChatHistoryEntry[], topicKeywords: string[]): boolean {
  const userContent = chatHistory
    .filter((m) => m.role === 'user')
    .map((m) => m.content.toLowerCase())
    .join(' ');
  return topicKeywords.some((kw) => userContent.includes(kw.toLowerCase()));
}

function templateAllowed(chatHistory: ChatHistoryEntry[], t: TemplateDef): boolean {
  return !t.avoidIfTopic?.length || !userMessagesCoverTopic(chatHistory, t.avoidIfTopic);
}

/**
 * Returns contextual prompt templates based on chat history and page context.
 * Uses full-sentence prompts; filters by page type (e.g. Jira) and avoids repeating topics already asked.
 */
export function getContextualPromptTemplates(
  chatHistory: ChatHistoryEntry[],
  pageContext: PageContext
): ChatPromptTemplate[] {
  const contextHints = detectContext(pageContext);

  const byHint = (h: 'jira' | 'confluence' | 'generic') =>
    POOL.filter(
      (t) =>
        t.contextHint === h &&
        (!t.contextHint || contextHints.includes(t.contextHint)) &&
        templateAllowed(chatHistory, t)
    );
  const jira = contextHints.includes('jira') ? byHint('jira') : [];
  const confluence = contextHints.includes('confluence') ? byHint('confluence') : [];
  const generic = byHint('generic');

  const ordered = [...jira, ...confluence, ...generic].slice(0, MAX_TEMPLATES);

  if (ordered.length < MAX_TEMPLATES) {
    const usedIds = new Set(ordered.map((t) => t.id));
    for (const id of GENERIC_FALLBACK_IDS) {
      if (ordered.length >= MAX_TEMPLATES) break;
      const fallback = POOL.find((t) => t.id === id && !usedIds.has(t.id));
      if (fallback && templateAllowed(chatHistory, fallback)) {
        ordered.push(fallback);
        usedIds.add(fallback.id);
      }
    }
  }

  return ordered.map((t) => ({
    id: t.id,
    label: t.prompt,
    prompt: t.prompt,
  }));
}

/**
 * Returns a static list (legacy); prefer getContextualPromptTemplates for context-aware suggestions.
 */
export function getChatPromptTemplates(): ChatPromptTemplate[] {
  return POOL.slice(0, MAX_TEMPLATES).map((t) => ({
    id: t.id,
    label: t.prompt,
    prompt: t.prompt,
  }));
}
