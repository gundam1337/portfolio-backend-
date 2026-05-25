// Step I4 — Indexer script.
// Scans src/indexing/documents/ for .md files, chunks each one, embeds every
// chunk via OpenAI text-embedding-3-large, and upserts into Qdrant.
//
// Run once (or re-run after editing a document):
//   npx tsx src/indexing/indexer.ts
//
// dotenv is loaded by importing qdrant.client.ts, so .env is read automatically.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createQdrantClient, getCollectionName } from './qdrant.client';
import { chunkDocument } from './chunking/chunker';
import { type ChunkPayload } from './types';
import OpenAI from 'openai';

const DOCUMENTS_DIR = path.join(__dirname, 'documents');
const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 3072;
// How many chunks to embed + upsert in one batch. Keeps memory flat and avoids
// hitting OpenAI's per-request token limit.
const BATCH_SIZE = 20;

// ─── OpenAI client ────────────────────────────────────────────────────────────

function createOpenAIClient(): OpenAI {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Add it to your .env file.');
  }
  return new OpenAI({ apiKey });
}

// ─── Embedding ────────────────────────────────────────────────────────────────

async function embedBatch(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  // API returns embeddings in the same order as the input texts.
  return response.data.map((d) => d.embedding);
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function findMarkdownFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const qdrant = createQdrantClient();
  const openai = createOpenAIClient();
  const collection = getCollectionName();

  const files = findMarkdownFiles(DOCUMENTS_DIR);
  if (files.length === 0) {
    console.log(`No .md files found in ${DOCUMENTS_DIR}`);
    return;
  }

  console.log(`Found ${files.length} file(s) to index.\n`);

  for (const filePath of files) {
    const sourceFile = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const sourceHash = sha256(content);
    const indexedAt = new Date().toISOString();

    console.log(`Chunking ${sourceFile}...`);
    const chunks = chunkDocument({ sourceFile, content });
    console.log(`  → ${chunks.length} chunks`);

    if (chunks.length === 0) {
      console.log(`  Skipping — no usable chunks produced.\n`);
      continue;
    }

    // Delete all existing points for this file before re-indexing so a re-run
    // doesn't leave stale chunks from a previous version of the document.
    await qdrant.delete(collection, {
      filter: { must: [{ key: 'sourceFile', match: { value: sourceFile } }] },
    });

    // Process in batches to avoid large OpenAI requests.
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
      process.stdout.write(`  Embedding batch ${batchNum}/${totalBatches}...`);

      const vectors = await embedBatch(
        openai,
        batch.map((c) => c.embeddingInput),
      );

      const points = batch.map((chunk, idx) => {
        const payload: ChunkPayload = {
          text: chunk.text,
          sourceFile: chunk.sourceFile,
          sourceType: chunk.sourceType,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunks.length,
          headingPath: chunk.headingPath,
          indexedAt,
          sourceHash,
        };

        return {
          // Deterministic ID: hash of file + chunkIndex → safe to re-run.
          id: deterministicId(sourceFile, chunk.chunkIndex),
          vector: vectors[idx]!,
          // Cast to satisfy Qdrant SDK's payload type (Record<string, unknown>).
          payload: payload as unknown as Record<string, unknown>,
        };
      });

      await qdrant.upsert(collection, { points, wait: true });
      process.stdout.write(' done\n');
    }

    console.log(`  ✓ ${sourceFile} indexed (${chunks.length} chunks)\n`);
  }

  console.log('Indexing complete.');
}

// Converts a string to a positive 64-bit-safe integer ID for Qdrant.
// Qdrant point IDs must be unsigned integers or UUIDs. We use the first 8
// bytes of a SHA-256 hash masked to a safe JS integer range.
function deterministicId(sourceFile: string, chunkIndex: number): number {
  const hash = crypto
    .createHash('sha256')
    .update(`${sourceFile}:${chunkIndex}`)
    .digest();
  // Read 6 bytes (48 bits) — safely within Number.MAX_SAFE_INTEGER.
  const high = hash.readUInt16BE(0);
  const low = hash.readUInt32BE(2);
  return high * 0x1_0000_0000 + low;
}

main().catch((err) => {
  console.error('Indexer failed:', err);
  process.exit(1);
});
