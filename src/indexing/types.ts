// Shared payload types for all Qdrant indexing scripts and the runtime search step.
// This file is type-only — it compiles to nothing at runtime.

export type SourceType = 'markdown' | 'pdf';

export interface ChunkPayload {
  text: string;
  sourceFile: string;
  sourceType: SourceType;
  chunkIndex: number;
  totalChunks: number;
  pageNumber?: number;      // PDF only
  headingPath?: string[];   // Markdown only — ordered list of heading ancestors
  indexedAt: string;        // ISO-8601 timestamp of when the chunk was indexed
  sourceHash: string;       // SHA-256 hex digest of the source file bytes
}
