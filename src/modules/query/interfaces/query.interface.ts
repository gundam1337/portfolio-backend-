import type { Message } from '../../../shared/session/session.types';

export interface QueryResponse {
  requestId: string;
  conversationId: string;
  status: 'received';
  question: string;
  // Last ≤10 messages, oldest first.  The answer field will be added in Step 4
  // once the RAG pipeline is wired in.
  history: Message[];
}
