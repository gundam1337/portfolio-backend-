import type { FallbackReason } from '../../query-rewriter/query-rewriter.types';
import type { Message } from '../../../shared/session/session.types';
import type { SourceMeta } from '../../prompt/prompt.types';

export interface EmbeddingMeta {
  model: string;
  dimensions: number;
  cached: boolean;
  durationMs: number;
}

export interface RetrievalMeta {
  count: number;
  topScore: number | null;
  lowestScore: number | null;
  lowConfidence: boolean;
  durationMs: number;
}

export interface RerankingTopResult {
  rerankerScore: number;
  vectorScore: number;
  sourceFile: string;
  headingPath: string[] | null;
  pageNumber: number | null;
  preview: string;
}

export interface RerankingMeta {
  used: boolean;
  model: string | null;
  topN: number;
  durationMs: number;
  fallbackReason: 'low_confidence' | 'api_error' | 'timeout' | 'invalid_response' | null;
  topResults: RerankingTopResult[];
}

export interface PromptMeta {
  totalTokens: number;
  systemTokens: number;
  historyTokens: number;
  contextTokens: number;
  userTokens: number;
  lowConfidenceMode: boolean;
  sourcesIncluded: SourceMeta[];
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
  reranking: RerankingMeta;
  prompt: PromptMeta;
  history: Message[];
}
