# RAG System — Technical Overview

**Portfolio Backend · Omar Derkaoui**

---

## What Is This?

A production-grade **Retrieval-Augmented Generation (RAG)** system built to answer questions about my professional profile — experience, projects, skills — with cited, grounded answers. Instead of relying on an LLM's parametric memory, the system retrieves relevant chunks from my actual documents, reranks them, then generates a response that is anchored to source material with traceable citations.

The architecture combines **three AI providers** (OpenAI, Cohere, Anthropic), **Qdrant** as the vector database, and **Redis** as the shared state layer, all orchestrated inside a **NestJS/Fastify** backend.

---

## High-Level Architecture

```
                         ┌─────────────────────────────────────────┐
                         │            HTTP Request                 │
                         │  POST /api/query                        │
                         │  { question, conversationId? }          │
                         └──────────────────┬──────────────────────┘
                                            │
                         ┌──────────────────▼──────────────────────┐
                         │         Input Pipeline                  │
                         │  1. SanitizationPipe (decancer)         │
                         │  2. InputGuardService (semantic check)  │
                         └──────────────────┬──────────────────────┘
                                            │
                         ┌──────────────────▼──────────────────────┐
                         │         Session Load (Redis)            │
                         │  Load or create conversation history    │
                         └──────────────────┬──────────────────────┘
                                            │
                 ┌──────────────────────────▼──────────────────────────────┐
                 │                    RAG Core Pipeline                    │
                 │                                                         │
                 │   [Query Rewriter]  →  [Embedding]  →  [Retrieval]      │
                 │    gpt-4o-mini          text-embedding       Qdrant      │
                 │    standalone form      -3-large 3072d       top-15      │
                 │                                                         │
                 │                        [Reranking]                      │
                 │                        Cohere rerank-v3.5               │
                 │                        30% semantic + 70% vector        │
                 │                        → top-5 hybrid-scored chunks     │
                 │                                                         │
                 │   [Prompt Builder]  →  [LLM Generation]                 │
                 │    token-counted        gpt-4o-mini                     │
                 │    source citations     temp 0.3                        │
                 └──────────────────────────┬──────────────────────────────┘
                                            │
                         ┌──────────────────▼──────────────────────┐
                         │         Response Assembly               │
                         │  Confidence scoring · Sources · Suggestions    │
                         └──────────────────┬──────────────────────┘
                                            │
                         ┌──────────────────▼──────────────────────┐
                         │         HTTP Response                   │
                         │  { answer, confidence, sources,         │
                         │    suggestions, conversationId }        │
                         └─────────────────────────────────────────┘
```

---

## The Indexing Pipeline (Offline)

Before any query can be answered, documents are pre-processed into searchable vector chunks. This pipeline runs once (or on document update) via a CLI script.

```
┌──────────────────────────────────────────────────────────┐
│                  Indexing Pipeline                       │
│                                                          │
│  documents/*.md                                          │
│       │                                                  │
│       ▼                                                  │
│  MarkdownChunker                                         │
│  • Parses heading hierarchy into stack-based paths       │
│  • Caps each chunk at 600 tokens (cl100k_base)           │
│  • 80-token overlap between adjacent chunks              │
│  • Never splits inside fenced code blocks                │
│  • Skips sections < 50 tokens (noise floor)              │
│       │                                                  │
│       ▼                                                  │
│  EmbeddingService (OpenAI text-embedding-3-large)        │
│  • Batches of 20 chunks per API call                     │
│  • 3072-dimensional dense vectors                        │
│       │                                                  │
│       ▼                                                  │
│  Qdrant Upsert                                           │
│  • Deterministic IDs: SHA-256(filename:chunkIndex)       │
│  • Deletes old points for the same sourceFile first      │
│  • Payload: text, sourceFile, sourceType, headingPath,   │
│             chunkIndex, indexedAt, sourceHash            │
└──────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **Deterministic IDs** make re-indexing idempotent — no orphaned stale vectors.
- **Heading-path payloads** (`["Work Experience", "FinaMaze"]`) allow the response to cite exact document sections.
- **Token-aware chunking** (not character-based) prevents truncation mismatches between indexing and embedding.

---

## The Query Pipeline (Online, Per Request)

### Stage 1 — Input Sanitization & Validation

```
Raw input
    │
    ├─► SanitizationPipe
    │     • Strips zero-width characters
    │     • Normalizes Unicode homoglyphs (via decancer)
    │     • Collapses excess whitespace
    │
    └─► InputGuardService
          • Length bounds: 2–2000 chars
          • Must contain at least one letter
          • Non-alphanumeric ratio ≤ 50%
          • Semantic plausibility check
```

This three-stage input pipeline is the first line of defense against prompt injection.

---

### Stage 2 — Query Rewriting

```
History + original question
        │
        ▼
  QueryRewriterService
  Model: gpt-4o-mini · Timeout: 3s
        │
        ▼
  Standalone question
  (preserves proper nouns & entities)
  Fallback: original question on timeout/error
```

Multi-turn conversations produce anaphoric questions like *"And what about his role there?"*. The rewriter resolves these into self-contained queries so the embedding step produces a semantically complete vector.

---

### Stage 3 — Embedding

```
Standalone question
        │
        ▼
  EmbeddingService
  Model: text-embedding-3-large
  Dimensions: 3072
  Retry: 3x with exponential backoff (1s → 3s)
        │
        ▼
  Query vector [3072 floats]
```

---

### Stage 4 — Vector Retrieval

```
Query vector [3072 floats]
        │
        ▼
  RetrievalService → Qdrant
  Collection: personal_docs
  Distance: Cosine similarity
  Top-K: 15 candidates
        │
        ├─ If topScore < 0.2 → low-confidence mode
        │
        ▼
  15 chunks with cosine scores + full payloads
```

The **score floor (0.2)** is a circuit breaker: if even the best-matching chunk is weakly relevant, the system signals low confidence and adjusts the LLM prompt accordingly rather than fabricating an answer.

---

### Stage 5 — Hybrid Reranking

```
Question + 15 candidate chunks
        │
        ▼
  RerankerService
  Model: Cohere rerank-v3.5
        │
        ▼
  Hybrid Score Computation:
  ┌────────────────────────────────────────────────────────┐
  │  hybridScore = (0.30 × rerankerScore)                  │
  │              + (0.70 × vectorScore)                    │
  │                                                        │
  │  Both scores normalized to [0.1, 1.0] before mixing.  │
  └────────────────────────────────────────────────────────┘
        │
        ▼
  Top-5 chunks sorted by hybridScore descending
```

The 30/70 weighting deliberately favors the vector score. The reranker provides a semantic re-ordering signal without overriding the retrieval quality signal from cosine similarity.

---

### Stage 6 — Prompt Construction & Token Budgeting

```
System message + History + Top-5 chunks + Question
        │
        ▼
  PromptBuilderService
  Token counter: js-tiktoken (cl100k_base)
        │
        ▼
  Final prompt with source annotations:
  ┌──────────────────────────────────────────────────────┐
  │  CONTEXT:                                            │
  │  [Source 1: cv.md > Work Experience > FinaMaze]      │
  │  <chunk text...>                                     │
  │                                                      │
  │  [Source 2: cv.md > Projects > FinaMaze API]         │
  │  <chunk text...>                                     │
  │  ...                                                 │
  │                                                      │
  │  QUESTION: What is Omar's backend experience?        │
  └──────────────────────────────────────────────────────┘
  Metadata: totalTokens, systemTokens, historyTokens,
            contextTokens, userTokens
```

---

### Stage 7 — LLM Generation & Response Assembly

```
Prompt
  │
  ├─► LlmService (gpt-4o-mini, temp 0.3)
  │     → Grounded answer in markdown
  │
  └─► SuggestionsService (gpt-4o-mini, temp 0.7, 8s budget)
        → 3 follow-up question suggestions

        ┌──────────────────────────────────────────────────┐
        │  Confidence Scoring:                             │
        │  hybridScore > 0.7  → "high"                    │
        │  hybridScore > 0.4  → "medium"                  │
        │  else / low-conf mode → "low"                   │
        └──────────────────────────────────────────────────┘

  Final HTTP Response:
  {
    "requestId": "uuid",
    "conversationId": "uuid",
    "answer": { "text": "...", "format": "markdown" },
    "confidence": { "level": "high", "reason": "..." },
    "sources": [
      { "id": "source_1", "title": "cv.md",
        "section": "Work Experience", "preview": "..." }
    ],
    "suggestions": ["What was his role at FinaMaze?", ...],
    "status": "answered"
  }
```

---

## The Chat Endpoint

Alongside the RAG query endpoint, a separate `/api/chat` endpoint provides a **streaming conversational interface** powered by Anthropic Claude.

```
POST /api/chat
Content-Type: application/json

{ "message": "Tell me about yourself", "conversationId": "..." }

         │
         ▼
  ChatService → Anthropic SDK
  Model: claude-haiku-4-5-20251001
  Max tokens: 512
  Persona: Omar's profile (chess, math, backend)
  Languages: English & French
         │
         ▼  Streaming
  Response: text/plain (raw UTF-8 chunks)
  Headers: X-Accel-Buffering: no
           Transfer-Encoding: chunked
```

This endpoint streams directly without SSE framing, reducing protocol overhead. It uses `content_block_delta` events from the Anthropic SDK to emit tokens as they arrive.

---

## State Management (Redis)

```
┌─────────────────────────────────────────────────┐
│                    Redis                        │
│                                                 │
│  Sessions      key: session:{uuid}              │
│                TTL: 1h (reset on append)        │
│                Max: 10 messages (FIFO drop)     │
│                                                 │
│  Rate Limits   Sliding-window per IP            │
│                10 req/min · 100 req/hr          │
│                                                 │
│  Cache         Response cache (TTL: 5 min)      │
└─────────────────────────────────────────────────┘
```

Redis is the shared-state backbone: session store, rate limiter, and response cache all use the same instance, keeping the architecture horizontally scalable.

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | NestJS 11 + Fastify | HTTP server & DI container |
| Query Rewriting | OpenAI gpt-4o-mini | Anaphora resolution |
| Embedding | OpenAI text-embedding-3-large | 3072d dense vectors |
| Vector DB | Qdrant (cloud) | ANN search, cosine similarity |
| Reranking | Cohere rerank-v3.5 | Semantic re-scoring |
| LLM Generation | OpenAI gpt-4o-mini | Answer synthesis |
| Chat | Anthropic claude-haiku-4-5 | Streaming conversation |
| Token Counting | js-tiktoken | Prompt budget control |
| Session Store | Redis + ioredis | Conversation history |
| Rate Limiting | @nestjs/throttler + Redis | Per-IP sliding window |
| Input Hardening | decancer | Unicode normalization |
| Logging | Pino + Pino-Loki | Structured log aggregation |
| Validation | class-validator + Zod | DTO & env validation |
| API Docs | Swagger / OpenAPI | Auto-generated spec |

---

## Security Layers

```
Request
  │
  ├── 1. Rate limiting (Redis sliding window)
  ├── 2. Helmet headers (@fastify/helmet)
  ├── 3. CORS policy
  ├── 4. Unicode normalization (decancer)
  ├── 5. Structural validation (class-validator)
  └── 6. Semantic input guard (LLM-assisted)
```

Every request passes through six layers before touching the RAG pipeline. The semantic input guard is the innermost check — it rejects inputs that are structurally valid but semantically malicious (e.g., prompt injection disguised as a question).

---

## Key Design Decisions

### Hybrid Reranking Weights (30 / 70)
The 30% Cohere / 70% vector split was chosen deliberately. Cohere reranking catches semantic relevance mismatches, but cosine similarity from `text-embedding-3-large` is already high-quality. Over-weighting the reranker risks penalizing technically accurate but paraphrase-heavy chunks. The 70% vector weight anchors the ranking in retrieval quality.

### Token-Based Chunking Over Character Splits
Character-based splitting creates variable token counts that can overflow embedding model context windows. Using `js-tiktoken` (cl100k_base) at chunking time guarantees that every chunk produced at index time fits within the same token budget used at query time.

### Deterministic Chunk IDs
Chunk IDs are `SHA-256(filename:chunkIndex)`. This makes the indexing pipeline idempotent — re-running it deletes and replaces only the vectors that belong to the updated file, without touching vectors from other documents.

### Low-Confidence Mode
When the top retrieval score falls below 0.2, the system does not refuse — it switches to a conservative prompt variant that instructs the LLM to acknowledge uncertainty. This avoids both hallucination and a hard failure experience.

### Raw Streaming (text/plain vs SSE)
The chat endpoint sends raw UTF-8 chunks rather than Server-Sent Events. For a portfolio UI that just appends tokens to a text field, the SSE framing overhead (data:, id:, event: prefixes) adds noise without benefit.

---

## Repository Structure

```
src/
├── modules/
│   ├── query/              # Main RAG endpoint + pipeline orchestration
│   │   ├── query.controller.ts
│   │   ├── query.service.ts
│   │   ├── input-guard.service.ts
│   │   └── pipes/sanitization.pipe.ts
│   ├── embedding/          # OpenAI text-embedding-3-large
│   ├── retrieval/          # Qdrant vector search
│   ├── reranking/          # Cohere hybrid reranker
│   ├── query-rewriter/     # gpt-4o-mini anaphora resolution
│   ├── prompt/             # Token-counted prompt assembly
│   ├── llm/                # gpt-4o-mini answer generation
│   └── chat/               # Anthropic streaming chat
├── shared/
│   └── session/            # Redis conversation store
├── config/
│   └── env.validation.ts   # Zod schema for environment
└── indexing/               # Offline document pipeline
    ├── indexer.ts           # Entry point: chunk → embed → upsert
    ├── setup-collection.ts  # Qdrant collection provisioning
    └── chunking/
        ├── markdown-chunker.ts
        └── token-counter.ts
```

---

## End-to-End Example

**Input:**
```json
{
  "question": "What backend frameworks has Omar worked with?",
  "conversationId": null
}
```

**Stage trace:**

| Stage | Input | Output |
|---|---|---|
| Sanitize | raw string | cleaned string |
| Guard | cleaned string | passes validation |
| Rewrite | question + `[]` history | `"What backend frameworks has Omar used professionally?"` |
| Embed | rewritten question | `[0.023, -0.041, ...]` (3072 floats) |
| Retrieve | query vector | 15 chunks, topScore = 0.82 |
| Rerank | question + 15 chunks | 5 chunks, hybridScores [0.91, 0.87, 0.76, 0.71, 0.64] |
| Prompt | 5 chunks + history | 1,240 tokens assembled |
| Generate | full prompt | markdown answer |
| Suggest | answer | 3 follow-up questions |
| Respond | assembled payload | HTTP 200 |

**Output:**
```json
{
  "requestId": "a3f7b2d1-...",
  "conversationId": "550e8400-...",
  "answer": {
    "text": "Omar has worked primarily with **NestJS** and **Fastify** ...",
    "format": "markdown"
  },
  "confidence": { "level": "high", "reason": "..." },
  "sources": [
    { "id": "source_1", "title": "cv.md", "section": "Work Experience", "preview": "..." }
  ],
  "suggestions": [
    "What databases has Omar worked with?",
    "Tell me about his NestJS projects",
    "What is Omar's experience with microservices?"
  ],
  "status": "answered"
}
```

---

*Built by Omar Derkaoui — NestJS · OpenAI · Cohere · Qdrant · Anthropic · Redis*
