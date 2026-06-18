<div align="center">

# Portfolio Backend

**A production-grade RAG system that answers questions about my professional profile with cited, grounded responses.**

[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?style=flat-square&logo=openai&logoColor=white)](https://openai.com/)
[![Anthropic](https://img.shields.io/badge/Anthropic-Claude-CC785C?style=flat-square)](https://anthropic.com/)
[![Qdrant](https://img.shields.io/badge/Qdrant-Vector_DB-DC244C?style=flat-square)](https://qdrant.tech/)
[![Redis](https://img.shields.io/badge/Redis-Sessions-FF4438?style=flat-square&logo=redis&logoColor=white)](https://redis.io/)

</div>

---

## What is this?

Instead of a static portfolio page, I built a backend that lets you **ask** about my experience and get accurate, cited answers. The system retrieves relevant chunks from my actual documents, reranks them with a hybrid scoring model, then generates a response anchored to source material — not parametric LLM memory.

```
"What backend frameworks has Omar worked with?"
        ↓
  Sanitize → Rewrite → Embed → Retrieve → Rerank → Generate → Respond
        ↓
"Omar has worked primarily with NestJS and Fastify..."
  Sources: [cv.md › Work Experience › FinaMaze]  Confidence: high
```

---

## Architecture

### High-Level Overview

![High-level architecture overview](<Screenshot 2026-06-18 at 1.42.18 AM.png>)

### Query Pipeline (7 stages, per request)

```
POST /api/query { question, conversationId? }
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  1. Input Pipeline                                  │
│     SanitizationPipe  → strips zero-width chars,   │
│                          normalizes Unicode glyphs  │
│     InputGuardService → length · char ratio ·       │
│                          semantic injection check   │
└───────────────────────────┬─────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────┐
│  2. Session Load (Redis)                            │
│     Load or create conversation history (TTL 1h)   │
└───────────────────────────┬─────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────┐
│  3. Query Rewriting  — gpt-4o-mini                  │
│     Resolves anaphora in multi-turn conversations   │
│     "And his role there?" → standalone question     │
│     Fallback: original question on timeout/error    │
└───────────────────────────┬─────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────┐
│  4. Embedding  — text-embedding-3-large             │
│     3072-dimensional dense vector                   │
│     Retry: 3× exponential backoff (1s → 3s)         │
└───────────────────────────┬─────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────┐
│  5. Vector Retrieval  — Qdrant                      │
│     Cosine similarity · top-15 candidates           │
│     topScore < 0.2 → low-confidence mode            │
└───────────────────────────┬─────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────┐
│  6. Hybrid Reranking  — Cohere rerank-v3.5          │
│                                                     │
│   hybridScore = (0.30 × rerankerScore)              │
│               + (0.70 × vectorScore)                │
│                                                     │
│     → top-5 chunks by hybrid score                  │
└───────────────────────────┬─────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────┐
│  7. Prompt Assembly + LLM Generation                │
│     PromptBuilderService — js-tiktoken budget       │
│     LlmService — gpt-4o-mini, temp 0.3              │
│     SuggestionsService — 3 follow-up questions      │
│     Confidence: high > 0.7 · medium > 0.4 · low     │
└───────────────────────────┬─────────────────────────┘
                            │
                            ▼
  { answer, confidence, sources, suggestions, conversationId }
```

### Indexing Pipeline (offline, run once per document update)

```
documents/*.md
      │
      ▼
MarkdownChunker
  • Heading hierarchy → stack-based section paths
  • 600-token cap  ·  80-token overlap
  • Never splits inside fenced code blocks
  • Skips sections < 50 tokens
      │
      ▼
EmbeddingService  — text-embedding-3-large
  • Batches of 20 chunks per API call
  • 3072d dense vectors
      │
      ▼
Qdrant Upsert
  • ID: SHA-256(filename:chunkIndex)  — idempotent re-indexing
  • Payload: text · sourceFile · headingPath · chunkIndex · sourceHash
```

---

## Chat Endpoint

A separate streaming endpoint for free-form conversation:

```
POST /api/chat { message, conversationId? }
      │
      ▼
ChatService → Anthropic claude-haiku-4-5
  Model: claude-haiku-4-5-20251001
  Max tokens: 512
  Stream: raw UTF-8 chunks (text/plain, no SSE framing)
  Headers: X-Accel-Buffering: no · Transfer-Encoding: chunked
```

---

## Security

Every request passes through six layers before touching the RAG pipeline:

| Layer | Mechanism |
|---|---|
| Rate limiting | Redis sliding window — 10 req/min · 100 req/hr |
| HTTP headers | `@fastify/helmet` |
| CORS | Configured origin allowlist |
| Unicode normalization | `decancer` — strips homoglyph attacks |
| Structural validation | `class-validator` DTOs |
| Semantic input guard | LLM-assisted — rejects prompt injection disguised as questions |

---

## State (Redis)

```
Sessions      key: session:{uuid}   TTL: 1h   Max: 10 messages (FIFO)
Rate limits   Sliding window per IP
Cache         Response cache        TTL: 5 min
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 + Fastify |
| Query rewriting | OpenAI gpt-4o-mini |
| Embeddings | OpenAI text-embedding-3-large (3072d) |
| Vector database | Qdrant Cloud |
| Reranking | Cohere rerank-v3.5 |
| Answer generation | OpenAI gpt-4o-mini |
| Streaming chat | Anthropic claude-haiku-4-5 |
| Token counting | js-tiktoken (cl100k_base) |
| Session store | Redis + ioredis |
| Rate limiting | @nestjs/throttler + Redis |
| Input hardening | decancer |
| Logging | Pino + Pino-Loki |
| Validation | class-validator + Zod |
| API docs | Swagger / OpenAPI |

---

## Project Structure

```
src/
├── modules/
│   ├── query/           # RAG endpoint + pipeline orchestration
│   ├── embedding/       # OpenAI text-embedding-3-large
│   ├── retrieval/       # Qdrant vector search
│   ├── reranking/       # Cohere hybrid reranker
│   ├── query-rewriter/  # Anaphora resolution
│   ├── prompt/          # Token-counted prompt assembly
│   ├── llm/             # Answer generation
│   └── chat/            # Anthropic streaming chat
├── shared/
│   └── session/         # Redis conversation store
├── config/
│   └── env.validation.ts
└── indexing/            # Offline document pipeline
    ├── indexer.ts
    ├── setup-collection.ts
    └── chunking/
        ├── markdown-chunker.ts
        └── token-counter.ts
```

---

## Getting Started

```bash
# Install dependencies
npm install

# Set environment variables (see below)
cp .env.example .env

# Provision Qdrant collection
npm run qdrant:setup

# Index documents
npm run index:docs

# Start dev server
npm run start:dev
```

### Required Environment Variables

```env
OPENAI_API_KEY=
COHERE_API_KEY=
ANTHROPIC_API_KEY=
QDRANT_URL=
QDRANT_API_KEY=
REDIS_URL=
```

---

## Key Design Decisions

**Hybrid reranking weights (30/70)** — Cohere semantic reranking catches relevance mismatches, but `text-embedding-3-large` cosine similarity is already high quality. Over-weighting the reranker risks penalizing paraphrase-heavy but accurate chunks. 70% vector weight anchors ranking in retrieval quality.

**Token-based chunking over character splits** — Character splits produce variable token counts that can overflow embedding model context windows. Using `js-tiktoken` at chunk time guarantees every chunk fits within the same token budget used at query time.

**Deterministic chunk IDs** — `SHA-256(filename:chunkIndex)` makes re-indexing idempotent. Re-running deletes and replaces only vectors for the updated file, without touching other documents.

**Low-confidence mode** — When top retrieval score falls below 0.2, the system doesn't fail or hallucinate. It switches to a conservative prompt variant that instructs the LLM to acknowledge uncertainty — avoiding both fabrication and a hard failure experience.

**Raw streaming over SSE** — The chat endpoint sends raw UTF-8 chunks rather than Server-Sent Events. For a portfolio UI that appends tokens to a text field, SSE framing (`data:`, `id:`, `event:` prefixes) adds noise without benefit.

---

<div align="center">

Built by **Omar Derkaoui**

</div>
