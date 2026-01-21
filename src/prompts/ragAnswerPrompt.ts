/**
 * Prompts for RAG answer generation
 * Used when generating answers from retrieved context chunks
 */

export interface RAGPromptOptions {
  query: string;
  context: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

/**
 * Create prompt for RAG answer generation with conversation history
 */
export function createRAGPromptWithHistory(options: RAGPromptOptions): string {
  const { query, context, conversationHistory } = options;
  
  if (conversationHistory && conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-10);
    const historyText = recentHistory
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');
    
    return `Based on the context below, answer the question. Provide a detailed answer. If the answer is not in the context, say "I cannot find this information in the provided context."

Previous conversation:
${historyText}

Question: ${query}

Context:
${context}

Answer:`;
  }
  
  return createRAGPromptWithoutHistory(options);
}

/**
 * Create prompt for RAG answer generation without conversation history
 */
export function createRAGPromptWithoutHistory(options: RAGPromptOptions): string {
  const { query, context } = options;
  
  return `Based on the context below, answer the question. Provide a detailed answer. If the answer is not in the context, say "I cannot find this information in the provided context."

Question: ${query}

Context:
${context}

Answer:`;
}
