import type { FallbackReason } from '../../query-rewriter/query-rewriter.types';
import type { Message } from '../../../shared/session/session.types';

export interface EmbeddingMeta {
  model: string;
  dimensions: number;
  cached: boolean;
  durationMs: number;
  /** First 5 values of the embedding vector — for debugging only. */
  preview: number[];
}

export interface QueryResponse {
  requestId: string;
  conversationId: string;
  originalQuestion: string;
  rewrittenQuestion: string;
  rewriteUsed: boolean;
  fallbackReason: FallbackReason | null;
  embedding: EmbeddingMeta;
  // Last ≤10 messages, oldest first.
  history: Message[];
}
