import type { RetrievedChunk } from '../retrieval/retrieval.types';

export interface RerankedChunk extends RetrievedChunk {
  rerankerScore: number;
  vectorScore: number;
}

export interface RerankResult {
  chunks: RerankedChunk[];
  used: boolean;
  model: string | null;
  durationMs: number;
  fallbackReason: 'low_confidence' | 'api_error' | 'timeout' | 'invalid_response' | null;
}
