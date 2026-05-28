export interface EmbedInput {
  text: string;
  requestId: string;
}

export interface EmbedResult {
  vector: number[];
  model: string;
  dimensions: number;
  durationMs: number;
}
