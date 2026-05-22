import type { FallbackReason } from '../../query-rewriter/query-rewriter.types';
import type { Message } from '../../../shared/session/session.types';

export interface QueryResponse {
  requestId: string;
  conversationId: string;
  originalQuestion: string;
  rewrittenQuestion: string;
  rewriteUsed: boolean;
  fallbackReason: FallbackReason | null;
  // Last ≤10 messages, oldest first.
  history: Message[];
}
