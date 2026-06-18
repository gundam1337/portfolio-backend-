# Building a Production RAG API with NestJS, Qdrant, and OpenAI

This tutorial walks through building a full Retrieval-Augmented Generation (RAG) API from scratch — from seeding the vector database to serving answers with source citations. The stack is **NestJS**, **Qdrant** (vector database), **OpenAI** (embeddings + chat), and **Cohere** (reranking), deployed on Render.

---

## Architecture Overview

The system is divided into two concerns:

1. **Indexing pipeline** — runs offline, transforms documents into vector embeddings stored in Qdrant.
2. **Query pipeline** — runs at request time, retrieves relevant chunks and generates an answer.

```
Documents (.md)
     │
     ▼
[Chunker] ──► [Token Counter] ──► chunks[]
     │
     ▼
[OpenAI Embeddings] ──► vectors[]
     │
     ▼
[Qdrant Upsert] ──► personal_docs collection

────────────────────────────────────────────────────────

User Question
     │
     ▼
[Query Rewriter] ──► standalone question
     │
     ▼
[Embedding Service] ──► query vector (cached in Redis)
     │
     ▼
[Qdrant Search] ──► top-15 candidate chunks
     │
     ▼
[Cohere Reranker] ──► top-5 reranked chunks
     │
     ▼
[Prompt Builder] ──► messages[] with CONTEXT block
     │
     ▼
[LLM (GPT-4o)] ──► answer + follow-up suggestions
```

---

## Part 1 — Setting Up the Qdrant Collection

Before indexing anything, you need a collection with the right shape.

**File:** `src/indexing/setup-collection.ts`

```typescript
const VECTOR_SIZE = 3072; // text-embedding-3-large output dimensions
const DISTANCE = 'Cosine';

await client.createCollection(collectionName, {
  vectors: {
    size: VECTOR_SIZE,
    distance: DISTANCE,
    on_disk: false, // keep in memory for fast search at small scale
  },
});
```

Two payload indexes are created for efficient filtered search — so you can later search within a specific document file without scanning the full collection:

```typescript
await client.createPayloadIndex(collectionName, {
  field_name: 'sourceFile',
  field_schema: 'keyword',
  wait: true,
});

await client.createPayloadIndex(collectionName, {
  field_name: 'sourceType',
  field_schema: 'keyword',
  wait: true,
});
```

The script supports a `--recreate` flag that prompts for confirmation before destroying the collection, with `--yes` to skip the prompt in CI.

Run it with:

```bash
npx tsx src/indexing/setup-collection.ts
npx tsx src/indexing/setup-collection.ts --recreate  # destructive rebuild
```

---

## Part 2 — Token Counting

Accurate token counting is essential for keeping chunks within the model's context window. The library choice matters here: `tiktoken` uses native/WASM bindings that fail to compile on some hosting providers like Render. **`js-tiktoken`** is pure JavaScript and works everywhere.

**File:** `src/indexing/chunking/token-counter.ts`

```typescript
import { getEncoding } from 'js-tiktoken';

// cl100k_base matches what text-embedding-3-large uses
const enc = getEncoding('cl100k_base');

// Initialize once — getEncoding() is expensive (~20ms)
export function countTokens(text: string): number {
  return enc.encode(text).length;
}

export function splitByTokens(text: string, maxTokens: number, overlapTokens: number): string[] {
  const tokens = enc.encode(text);
  const safeOverlap = Math.min(overlapTokens, maxTokens - 1);
  const step = maxTokens - safeOverlap;
  const chunks: string[] = [];

  for (let start = 0; start < tokens.length; start += step) {
    const slice = tokens.slice(start, start + maxTokens);
    chunks.push(enc.decode(slice) as unknown as string);
  }
  return chunks;
}
```

The encoder is initialized once at module load and reused across all calls.

---

## Part 3 — Document Chunking

The Markdown chunker is structured in four layers:

1. **Heading parser** — groups document lines into sections by heading path
2. **Paragraph splitter** — splits section bodies on blank lines while respecting fenced code blocks
3. **Paragraph packer** — greedily fills chunks up to MAX_TOKENS, with overlap for continuity
4. **embeddingInput builder** — prefixes each chunk with `[Source: file > heading > path]`

**File:** `src/indexing/chunking/markdown-chunker.ts`

### Constants

```typescript
const MAX_TOKENS = 600;
const OVERLAP_TOKENS = 80;
const MIN_TOKENS = 50; // skip sections too small to be useful
```

### Heading Path Stack

The heading stack tracks the current document hierarchy (`["2024", "March", "Tokyo"]`). When a new heading arrives, all entries at the same or deeper level are popped before pushing the new one:

```typescript
function pushHeading(
  stack: Array<{ level: number; title: string }>,
  level: number,
  title: string,
): void {
  while (stack.length > 0 && stack[stack.length - 1].level >= level) {
    stack.pop();
  }
  stack.push({ level, title });
}
```

### Code-Block-Safe Paragraph Splitter

Naively splitting on `\n\n` would break fenced code blocks. The splitter counts `\`\`\`` occurrences per paragraph: an odd count means a fence opened without closing, so subsequent paragraphs are merged until the fence closes:

```typescript
function splitParagraphsRespectingCodeBlocks(body: string): string[] {
  const rawParagraphs = body.split(/\n\n+/);
  let insideBlock = false;
  let accumulated: string[] = [];
  const result: string[] = [];

  for (const para of rawParagraphs) {
    const fenceCount = (para.match(/^```/gm) ?? []).length;
    if (!insideBlock) {
      if (fenceCount % 2 === 1) { insideBlock = true; accumulated.push(para); }
      else { result.push(para); }
    } else {
      accumulated.push(para);
      if (fenceCount % 2 === 1) {
        insideBlock = false;
        result.push(accumulated.join('\n\n'));
        accumulated = [];
      }
    }
  }
  return result.filter(p => p.trim().length > 0);
}
```

### Greedy Paragraph Packer with Overlap

Paragraphs are packed greedily into chunks. When a chunk overflows, the last `OVERLAP_TOKENS` tokens of the previous chunk are prepended to the next one, providing context continuity:

```typescript
const MAX_TOKENS = 600;
const OVERLAP_TOKENS = 80;

// On overflow: emit current chunk, carry overlap into next
if (currentTokens + paraTokens > MAX_TOKENS) {
  emit(); // saves chunk, computes overlapCarry
  const startText = overlapCarry ? overlapCarry + '\n\n' + para : para;
  currentPieces.push(startText);
  currentTokens = countTokens(startText);
}
```

### Embedding Input Format

Each chunk gets a `[Source: ...]` prefix that encodes the file and heading path. This context lands inside the embedding itself, improving retrieval accuracy:

```
[Source: resume.md > Experience > Senior Engineer] Led a team of 4 engineers...
```

---

## Part 4 — Indexer Script

The indexer scans a documents directory, chunks each Markdown file, embeds all chunks in batches of 20, and upserts into Qdrant.

**File:** `src/indexing/indexer.ts`

### Key design decisions

**Deterministic point IDs** — IDs are derived from `SHA-256(filename:chunkIndex)`, so re-running the indexer on the same file produces the same IDs. This makes upserts idempotent and avoids duplicate points:

```typescript
function deterministicId(sourceFile: string, chunkIndex: number): number {
  const hash = crypto
    .createHash('sha256')
    .update(`${sourceFile}:${chunkIndex}`)
    .digest();
  // 6 bytes (48 bits) — safely within Number.MAX_SAFE_INTEGER
  const high = hash.readUInt16BE(0);
  const low = hash.readUInt32BE(2);
  return high * 0x1_0000_0000 + low;
}
```

**Stale chunk cleanup** — before indexing a file, all existing points for that `sourceFile` are deleted. This prevents orphaned chunks from a previous (longer) version of the document from lingering:

```typescript
await qdrant.delete(collection, {
  filter: { must: [{ key: 'sourceFile', match: { value: sourceFile } }] },
});
```

**Batched embedding** — chunks are embedded in batches of 20 to avoid hitting OpenAI's per-request token limits and keep memory usage flat:

```typescript
const BATCH_SIZE = 20;

for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
  const batch = chunks.slice(i, i + BATCH_SIZE);
  const vectors = await embedBatch(openai, batch.map(c => c.embeddingInput));
  // upsert batch...
}
```

**Payload stored with each point:**

```typescript
{
  text: string;         // raw chunk text shown to the LLM
  sourceFile: string;   // filename for source attribution
  sourceType: string;   // 'markdown' or 'pdf'
  chunkIndex: number;   // position within the document
  totalChunks: number;  // total chunks in the document
  headingPath: string[]; // heading breadcrumb
  indexedAt: string;    // ISO timestamp
  sourceHash: string;   // SHA-256 of the full file content
}
```

Run with:
```bash
npx tsx src/indexing/indexer.ts
```

---

## Part 5 — Query Pipeline (NestJS)

Each incoming question flows through a multi-stage NestJS service pipeline before an answer is returned.

### Stage 1 — Session Management

Before any processing, the conversation state is loaded from Redis. If no `conversationId` is provided, a new session is created:

```typescript
const session = await this.sessionService.loadOrCreate(dto.conversationId);
const historyBeforeAppend = await this.sessionService.getRecentHistory(session.id);
await this.sessionService.appendUserMessage(session.id, dto.question);
```

### Stage 2 — Query Rewriting

Multi-turn conversations produce follow-up questions like "what else did he do?" that are useless for retrieval without context. The query rewriter uses GPT-4o-mini to rewrite such questions into standalone form:

**File:** `src/modules/query-rewriter/query-rewriter.service.ts`

```
History: User asked about Omar's work experience.
Message: "what about his side projects?"
Rewrite: What side projects has Omar worked on?
```

Key guards:
- **3-second timeout** — falls back to the original question if rewriting takes too long
- **Output validation** — rejects empty, overlong, or suspiciously prefixed outputs (`"sure"`, `"here"`, `'"'`, etc.)
- **Graceful fallback** — any failure returns `rewriteUsed: false` and the original question unchanged

### Stage 3 — Embedding (with Redis cache)

The rewritten question is embedded using `text-embedding-3-large` (3072 dimensions). Results are cached in Redis to avoid re-embedding the same query on repeated requests:

**File:** `src/modules/embedding/embedding.service.ts`

```typescript
const response = await this.openai.embeddings.create({
  model: 'text-embedding-3-large',
  input: text,
  dimensions: 3072,
  encoding_format: 'float',
});
```

The service uses a retry utility with exponential backoff (up to 3 attempts) for transient OpenAI failures.

### Stage 4 — Vector Retrieval from Qdrant

The query vector is searched against the collection to retrieve the top-15 most similar chunks by cosine similarity.

**File:** `src/modules/retrieval/retrieval.service.ts`

```typescript
await this.qdrant.search(this.collection, {
  vector: queryVector,
  limit: 15,          // broader net before reranking
  with_payload: true,
  with_vector: false,
});
```

A `lowConfidence` flag is set when the top score is below the configured floor (`RETRIEVAL_SCORE_FLOOR`). This propagates downstream to prevent hallucination — if no relevant content exists, the LLM is explicitly told so.

### Stage 5 — Reranking with Cohere

Cosine similarity is a blunt instrument. The Cohere `rerank-v3.5` model re-scores the 15 candidates by semantic relevance to the query and selects the top 5.

**File:** `src/modules/reranking/reranker.service.ts`

The final ranking uses a **hybrid score** combining both signals rather than discarding the vector score:

```typescript
const RERANKER_WEIGHT = 0.3;

const normalize = (val: number, min: number, max: number) =>
  max === min ? 1 : 0.1 + 0.9 * (val - min) / (max - min);

const hybridScore =
  RERANKER_WEIGHT * normReranker + (1 - RERANKER_WEIGHT) * normVector;
```

Both scores are min-max normalized before blending. The 0.1 floor prevents a legitimately relevant chunk from scoring near zero just because it happened to be the weakest in this particular result set.

### Stage 6 — Prompt Construction

The top-5 chunks are assembled into a structured prompt with a `CONTEXT:` block. Each chunk is labeled with its source file and heading path so the LLM can cite it:

**File:** `src/modules/prompt/prompt-builder.service.ts`

```
CONTEXT:

[Source 1: resume.md > Experience > Senior Engineer]
Led a team of 4 engineers...

[Source 2: resume.md > Skills]
TypeScript, NestJS, PostgreSQL...

QUESTION: What technologies does Omar use?
```

When `lowConfidenceMode` is active (no relevant chunks found), the context block is omitted and the LLM receives a different system prompt instructing it to say it doesn't know — preventing hallucination.

**System message (normal mode):**
```
You are a helpful assistant that answers questions using only the information
provided in the CONTEXT section below.
...
- Never speculate or invent information that isn't in the context.
```

**System message (low confidence mode):**
```
No relevant information was found in the available documents for the current
question. Respond clearly and briefly that you don't have information about
this in the documents. Do not attempt to answer from general knowledge.
```

### Stage 7 — LLM Generation

The assembled messages are sent to GPT-4o with a 30-second timeout. After the answer is generated, a second lightweight call to the same model produces 3 follow-up question suggestions:

**File:** `src/modules/llm/llm.service.ts`

```typescript
// Main answer
const response = await this.openai.chat.completions.create({
  model: this.model,
  messages,        // system + history + CONTEXT block + question
  temperature: 0.3,
});

// Follow-up suggestions (separate call, 8s timeout, higher temperature)
const suggestions = await this.suggestFollowUps(question, answer, requestId);
```

---

## Part 6 — API Response Shape

The final response from `QueryService` includes:

```typescript
{
  requestId: string;
  conversationId: string;
  answer: {
    text: string;    // markdown-formatted answer
    format: 'markdown';
  };
  confidence: {
    level: 'high' | 'medium' | 'low';
    reason: string;
  };
  sources: Array<{
    id: string;
    title: string;       // source filename
    type: 'markdown' | 'pdf';
    section: string | null;  // deepest heading in headingPath
    pageNumber: number | null;
    preview: string;     // first 200 chars of the chunk
  }>;
  suggestions: string[];  // 3 follow-up questions
  status: 'answered' | 'low_confidence';
}
```

Confidence is derived from the top Cohere reranker score:
- `> 0.7` → `high`
- `> 0.4` → `medium` (includes the section name in the reason)
- `≤ 0.4` or low confidence mode → `low`

---

## Environment Variables

```bash
# Qdrant
QDRANT_URL=https://your-cluster.qdrant.io
QDRANT_API_KEY=your-api-key
QDRANT_COLLECTION=personal_docs

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
OPENAI_EMBEDDING_DIMENSIONS=3072
OPENAI_REWRITER_MODEL=gpt-4o-mini
OPENAI_CHAT_MODEL=gpt-4o

# Cohere
COHERE_API_KEY=...
COHERE_RERANK_MODEL=rerank-v3.5
RERANK_TOP_N=5

# Retrieval
RETRIEVAL_TOP_K=15
RETRIEVAL_SCORE_FLOOR=0.3

# Redis (for embedding cache and session store)
REDIS_URL=redis://...
```

---

## Running the Full Pipeline

```bash
# 1. Create the Qdrant collection
npx tsx src/indexing/setup-collection.ts

# 2. Place Markdown files in src/indexing/documents/

# 3. Run the indexer
npx tsx src/indexing/indexer.ts

# 4. Start the API
pnpm start:dev
```

Query the API:
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is your experience with TypeScript?"}'
```
