# RAG Pipeline — Step-by-Step Guide

This document outlines the complete request lifecycle for a production-ready Retrieval-Augmented Generation (RAG) system.

---

## Step 1 — Request ingress and authentication

The user's HTTP request hits your API gateway or load balancer. You verify the API key or JWT, check rate limits for this user, and reject the request early if anything is off. No point doing expensive work for a request that shouldn't run.

---

## Step 2 — Input validation and sanitization

Parse the JSON body, confirm the question field exists and isn't empty, enforce a max length (say 2000 characters), and strip anything dangerous. This is also where you'd block prompt injection attempts at a basic level — e.g., reject obvious "ignore previous instructions" patterns if you care about that.

---

## Step 3 — Session and conversation context loading

If this is a multi-turn chat, load the previous N messages from your session store (Redis, Postgres, wherever). If it's stateless single-shot Q&A, skip this step.

---

## Step 4 — Query rewriting (conditional)

If conversation history exists, send the history plus the new question to a cheap, fast LLM (GPT-4o-mini or similar) with a prompt like "rewrite this follow-up as a standalone question." This turns "what about his drink?" into "what is Omar's favorite drink?" Skip entirely for single-shot systems.

---

## Step 5 — Query embedding

Send the (rewritten) question to OpenAI's text-embedding-3-large endpoint. You get back a vector — same model and same dimensions you used when indexing your documents. Cache this call if you see repeat questions; embedding the same text twice is wasted money.

---

## Step 6 — Metadata filter construction

Build the filter conditions for Qdrant based on the user's permissions and context. Examples: `user_id = current_user`, `document_visibility = public`, `tenant_id = X`. This is your access control layer — it stops User A from retrieving User B's documents.

---

## Step 7 — Vector search

Query Qdrant with the question vector plus the metadata filters. Ask for top 20–50 candidates, not top 3. Qdrant returns chunk IDs, similarity scores, the chunk text, and metadata (source document, page number, etc.).

---

## Step 8 — Hybrid search merge (optional but recommended)

In parallel with step 7, run a keyword/BM25 search over the same corpus. Merge the two result sets using a method like Reciprocal Rank Fusion. This catches things vector search misses — proper names, codes, acronyms, exact phrases.

---

## Step 9 — Reranking

Take your 20–50 candidates and send them to a reranker (Cohere Rerank, a cross-encoder model, or similar) along with the original question. The reranker scores each candidate by true relevance, not just vector similarity. Keep the top 3–8 chunks.

---

## Step 10 — Context assembly and token budgeting

Concatenate the surviving chunks into a context block, with clear separators and source labels so the LLM can cite. Count tokens. If you're over budget, drop the lowest-ranked chunks until you fit. Reserve enough headroom for the system prompt, the question, and the answer.

---

## Step 11 — Prompt construction

Build the final prompt sent to GPT-4. Structure looks like:

- System instruction (how to behave, citation rules, refusal policy)
- Context block (the retrieved chunks)
- Conversation history (if any)
- User's current question

This is where you enforce "answer only from context" and "say 'I don't know' if the context doesn't cover it."

---

## Step 12 — LLM generation

Send the prompt to GPT-4 via the chat completions API. Stream the response back if your client supports it (better perceived latency). Handle timeouts and retries with exponential backoff. Log the token counts for cost tracking.

---

## Step 13 — Output validation and guardrails

Before sending the answer to the user, check it:

- Does it contain PII it shouldn't?
- Did the model refuse appropriately?
- Did it stay on-topic?

For high-stakes domains (medical, legal, financial) you might run a second LLM call as a "judge" to verify the answer is grounded in the provided context.

---

## Step 14 — Citation extraction

Parse the model's response to extract which sources it cited. Map these back to the original document IDs and build a citations array the frontend can render as clickable references.

---

## Step 15 — Response assembly

Package the final response as JSON: the answer text, citations array, conversation ID, token usage, latency metrics. Send it back to the user.

---

## Step 16 — Persistence and logging

Asynchronously (don't block the response) write the full transaction to your logs and database: question, rewritten question, retrieved chunk IDs, reranker scores, final prompt, model response, latency at each step, total cost. This is the data you'll use for evaluation, debugging, and improving the system later.

---

## Step 17 — Observability and metrics emission

Emit metrics to your monitoring system: request count, p50/p95/p99 latency per step, error rates, token usage, cost per request. This is how you catch when something starts going wrong before users complain.

---

## Step 18 — Session update

Append the question and answer to the conversation history in your session store, so the next turn has the context it needs for step 4.