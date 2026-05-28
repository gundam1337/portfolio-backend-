import type { RetrievedChunk } from '../retrieval/retrieval.types';

export interface RerankedChunk extends RetrievedChunk {
  rerankerScore: number;
  vectorScore: number;
}

export interface RerankResult {
  chunks: RerankedChunk[];
  used: true;
  model: string;
  durationMs: number;
  fallbackReason: null;
}
