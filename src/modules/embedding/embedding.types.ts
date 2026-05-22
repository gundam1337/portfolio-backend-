export interface EmbedInput {
  text: string;
  requestId: string;
}

export interface EmbedResult {
  vector: number[];
  model: string;
  dimensions: number;
  cached: boolean;
  durationMs: number;
}

/** Shape persisted in Redis. */
export interface CachedEmbedding {
  vector: number[];
  model: string;
  dimensions: number;
  createdAt: string;
}
