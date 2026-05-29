# Query API — Frontend Integration Guide

## Overview

The Query API is a single POST endpoint that accepts a natural-language question and returns an AI-generated answer sourced from Omar's portfolio documents. It supports multi-turn conversations via a session ID.

---

## Endpoint

```
POST /api/query
Content-Type: application/json
```

---

## Request

### Body

| Field            | Type     | Required | Description                                                                 |
|------------------|----------|----------|-----------------------------------------------------------------------------|
| `question`       | `string` | Yes      | The user's question. Min 2 chars, max 2000 chars.                          |
| `conversationId` | `string` (UUID v4) | No | Pass the `conversationId` from a previous response to continue that thread. Omit to start a new conversation. |

### Example — new conversation

```json
{
  "question": "What is Omar's experience?"
}
```

### Example — follow-up turn

```json
{
  "question": "What about his education?",
  "conversationId": "a3f1c2d4-5e6b-7890-abcd-ef1234567890"
}
```

---

## Response

HTTP `200 OK` on success.

### Shape

```typescript
{
  requestId:      string;
  conversationId: string;          // save this for follow-up questions
  status:         "answered" | "low_confidence";
  answer: {
    text:   string;                // markdown-formatted answer
    format: "markdown";
  };
  confidence: {
    level:  "high" | "medium" | "low";
    reason: string;                // human-readable explanation
  };
  sources: Array<{
    id:         string;            // e.g. "source_1"
    title:      string;            // filename, e.g. "omar-cv.pdf"
    type:       "pdf" | "markdown";
    section:    string | null;     // heading in the document, e.g. "Skills"
    pageNumber: number | null;     // PDF page, null for markdown
    preview:    string;            // first ~200 chars of the source chunk
  }>;
  suggestions: string[];           // 3 suggested follow-up questions
}
```

### Example response

```json
{
  "requestId": "req_01HZ...",
  "conversationId": "a3f1c2d4-5e6b-7890-abcd-ef1234567890",
  "status": "answered",
  "answer": {
    "text": "Omar has **3 years of experience** as a full-stack engineer...",
    "format": "markdown"
  },
  "confidence": {
    "level": "high",
    "reason": "The answer was generated from highly relevant content in Omar's portfolio."
  },
  "sources": [
    {
      "id": "source_1",
      "title": "omar-cv.pdf",
      "type": "pdf",
      "section": "Experience",
      "pageNumber": 1,
      "preview": "Full-stack engineer with 3 years of experience building..."
    }
  ],
  "suggestions": [
    "What technologies does Omar use?",
    "What projects has Omar built?",
    "Does Omar have open-source contributions?"
  ]
}
```

---

## Error Responses

| HTTP Status | When it happens | Body shape |
|-------------|-----------------|------------|
| `400 Bad Request` | `question` is missing, too short/long, contains no letters, or is >50% symbols | `{ "message": "...", "error": "Bad Request", "statusCode": 400 }` |
| `429 Too Many Requests` | Rate limit exceeded | `{ "message": "Too Many Requests", "statusCode": 429 }` |

### 400 examples

```json
{ "message": "question must be longer than or equal to 2 characters" }
{ "error": "question contains no alphabetic characters" }
{ "error": "question contains too many non-alphanumeric characters", "detail": "60% of characters are symbols or punctuation (limit 50%)" }
```

---

## Multi-turn Conversations

1. First request — send without `conversationId`.
2. Save the `conversationId` from the response.
3. Every follow-up — send the same `conversationId`.
4. The backend maintains history automatically; the frontend does not need to replay messages.

```
Turn 1:  POST { question: "What is Omar's experience?" }
         ← { conversationId: "abc-123", answer: {...}, ... }

Turn 2:  POST { question: "Tell me more about his projects.", conversationId: "abc-123" }
         ← { conversationId: "abc-123", answer: {...}, ... }
```

---

## Handling `status`

| Value | Meaning | Suggested UI behaviour |
|-------|---------|------------------------|
| `"answered"` | Relevant content was found | Render `answer.text` normally |
| `"low_confidence"` | No sufficiently relevant content found | Show `answer.text` with a disclaimer, e.g. *"This answer may not be based on Omar's portfolio"* |

---

## Rendering the Answer

`answer.text` is **Markdown**. Use a Markdown renderer (e.g. `react-markdown`, `marked`) to display it. Do not render it as plain text.

---

## Displaying Sources

Sources are already ordered by relevance (highest first). Recommended display: a collapsible "Sources" section below the answer showing `title`, `section`, and `preview`.

---

## TypeScript Types (copy-paste ready)

```typescript
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type QueryStatus = 'answered' | 'low_confidence';

export interface QueryRequest {
  question: string;
  conversationId?: string;
}

export interface QuerySource {
  id: string;
  title: string;
  type: 'pdf' | 'markdown';
  section: string | null;
  pageNumber: number | null;
  preview: string;
}

export interface QueryResponse {
  requestId: string;
  conversationId: string;
  status: QueryStatus;
  answer: {
    text: string;
    format: 'markdown';
  };
  confidence: {
    level: ConfidenceLevel;
    reason: string;
  };
  sources: QuerySource[];
  suggestions: string[];
}
```

---

## Minimal fetch example

```typescript
async function askQuestion(
  question: string,
  conversationId?: string,
): Promise<QueryResponse> {
  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, conversationId }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message ?? 'Query failed');
  }

  return res.json() as Promise<QueryResponse>;
}
```
