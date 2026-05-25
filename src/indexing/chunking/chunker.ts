// High-level dispatcher for Step I2 (Document Chunking).
// This is the only file the indexer (Step I4) needs to import from this layer.

import { type Chunk } from '../types';
import { chunkMarkdown } from './markdown-chunker';

export interface ChunkDocumentInput {
  sourceFile: string;
  content: string;
}

/**
 * Chunks a Markdown document into Chunk objects ready for embedding and indexing.
 */
export function chunkDocument(input: ChunkDocumentInput): Chunk[] {
  return chunkMarkdown(input.content, input.sourceFile);
}
