import type { ChunkPayload } from '../../indexing/types';

// ChunkPayload is the exact contract written by the indexer into Qdrant payloads.
// Importing it here (rather than redefining) ensures the retriever and indexer
// stay in sync whenever the payload schema changes.
export type { ChunkPayload };

export interface RetrievedChunk {
  id: string | number;
  score: number;
  text: string;
  sourceFile: string;
  sourceType: 'markdown' | 'pdf';
  chunkIndex: number;
  totalChunks: number;
  pageNumber?: number;
  headingPath?: string[];
}

export interface RetrievalResult {
  /** Up to top-K chunks, ordered by score descending. */
  chunks: RetrievedChunk[];
  /** Score of the highest-ranked chunk, or null when no chunks returned. */
  topScore: number | null;
  /** Score of the lowest-ranked chunk, or null when no chunks returned. */
  lowestScore: number | null;
  /** True when topScore < SCORE_FLOOR or no chunks were returned. */
  lowConfidence: boolean;
  durationMs: number;
  /** Number of dimensions in the query vector — useful for debugging config drift. */
  queryDimensions: number;
}
