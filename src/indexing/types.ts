// Shared payload types for all Qdrant indexing scripts and the runtime search step.
// This file is type-only — it compiles to nothing at runtime.

export type SourceType = 'markdown';

export interface ChunkPayload {
  text: string;
  sourceFile: string;
  sourceType: SourceType;
  chunkIndex: number;
  totalChunks: number;
  headingPath?: string[];   // ordered list of heading ancestors
  indexedAt: string;        // ISO-8601 timestamp of when the chunk was indexed
  sourceHash: string;       // SHA-256 hex digest of the source file bytes
}

// Intermediate product of Step I2 (chunking). Consumed by Step I4 (indexer).
// Pure data — no I/O, no framework dependencies.
export interface Chunk {
  // Raw text stored in Qdrant payload and shown to GPT-4 as context.
  text: string;
  // Contextualized text actually sent to the embedding API.
  // Adds a [Source: ...] prefix so the vector encodes document provenance.
  embeddingInput: string;
  sourceFile: string;
  sourceType: SourceType;
  // 0-based within the document (not per-section), in document order.
  chunkIndex: number;
  headingPath?: string[];   // e.g. ["Professional Experience", "Backend Software Engineer"]
  // Token count of `text` (not embeddingInput) using cl100k_base encoding.
  tokenCount: number;
}
