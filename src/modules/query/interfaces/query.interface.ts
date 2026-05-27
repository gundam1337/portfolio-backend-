import type { FallbackReason } from '../../query-rewriter/query-rewriter.types';
import type { Message } from '../../../shared/session/session.types';

export interface EmbeddingMeta {
  model: string;
  dimensions: number;
  cached: boolean;
  durationMs: number;
}

export interface RetrievalTopResult {
  score: number;
  sourceFile: string;
  headingPath: string[] | null;
  pageNumber: number | null;
  preview: string;
}

export interface RetrievalMeta {
  count: number;
  topScore: number | null;
  lowestScore: number | null;
  lowConfidence: boolean;
  durationMs: number;
  /** First 5 results with preview text truncated to 200 chars — primary debug surface. */
  topResults: RetrievalTopResult[];
}

export interface QueryResponse {
  requestId: string;
  conversationId: string;
  originalQuestion: string;
  rewrittenQuestion: string;
  rewriteUsed: boolean;
  fallbackReason: FallbackReason | null;
  embedding: EmbeddingMeta;
  retrieval: RetrievalMeta;
  // Last ≤10 messages, oldest first.
  history: Message[];
}
