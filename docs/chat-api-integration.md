# Chat API — Frontend Integration Guide

## Overview

The Chat API is a streaming POST endpoint that powers the portfolio AI assistant. It accepts a conversation history and streams back a plain-text response from Claude Haiku. Unlike the Query API, it does **not** search documents — it answers based on the built-in system prompt about Omar.

---

## Endpoint

```
POST /api/chat
Content-Type: application/json
```

---

## Request

### Body

| Field       | Type                              | Required | Description                                              |
|-------------|-----------------------------------|----------|----------------------------------------------------------|
| `messages`  | `Array<{ role, content }>`        | Yes      | Full conversation history. Min 1, max 40 messages.       |
| `language`  | `"en"` \| `"fr"`                  | No       | Response language. Defaults to English if omitted.       |

### `messages` item

| Field     | Type                        | Required | Constraints          |
|-----------|-----------------------------|----------|----------------------|
| `role`    | `"user"` \| `"assistant"`   | Yes      | Strict alternation — must start with `"user"` |
| `content` | `string`                    | Yes      | 1–4000 chars         |

### Example — first message

```json
{
  "messages": [
    { "role": "user", "content": "Who is Omar?" }
  ],
  "language": "en"
}
```

### Example — follow-up turn

```json
{
  "messages": [
    { "role": "user",      "content": "Who is Omar?" },
    { "role": "assistant", "content": "Omar is a backend engineer from Morocco..." },
    { "role": "user",      "content": "Has he worked in fintech?" }
  ],
  "language": "en"
}
```

---

## Response

HTTP `200 OK` with a **streaming plain-text body** (chunked transfer encoding).

- `Content-Type: text/plain; charset=utf-8`
- The response body arrives in chunks — read it as a `ReadableStream`
- There are **no SSE `data:` prefixes** — it is raw text

---

## Error Responses

| HTTP Status | When it happens | Body shape |
|-------------|-----------------|------------|
| `400 Bad Request` | Validation failed (missing field, wrong type, empty array) | `{ "message": "...", "statusCode": 400 }` |
| `429 Too Many Requests` | Rate limit exceeded (10 req/min per IP) | `{ "message": "Too Many Requests", "statusCode": 429 }` |

---

## TypeScript Types

```typescript
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  language?: 'en' | 'fr';
}
```

---

## Conversation History Management

The backend is stateless — it does not store history. The frontend must:

1. Keep `messages` in local state
2. Append `{ role: 'user', content }` before each request
3. Collect the full streamed reply, then append `{ role: 'assistant', content: reply }` after the stream ends
4. Send the full updated array on the next request

```
Turn 1 send:    [{ role: "user", content: "Who is Omar?" }]
Turn 1 receive: "Omar is a backend engineer..."

Turn 2 send:    [
                  { role: "user",      content: "Who is Omar?" },
                  { role: "assistant", content: "Omar is a backend engineer..." },
                  { role: "user",      content: "Has he worked in fintech?" }
                ]
Turn 2 receive: "Yes, he's currently at FinaMaze..."
```

---

## Streaming Fetch Example

```typescript
async function streamChat(
  messages: ChatMessage[],
  language: 'en' | 'fr' = 'en',
  onChunk: (chunk: string) => void,
): Promise<string> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, language }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message ?? 'Chat request failed');
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let fullReply = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    fullReply += chunk;
    onChunk(chunk);
  }

  return fullReply;
}
```

---

## React Hook Example

```typescript
function useChat(language: 'en' | 'fr' = 'en') {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [loading, setLoading] = useState(false);

  async function send(input: string) {
    const next = [...messages, { role: 'user' as const, content: input }];
    setMessages(next);
    setLoading(true);
    setStreaming('');

    let reply = '';

    try {
      reply = await streamChat(next, language, (chunk) => {
        setStreaming((prev) => prev + chunk);
      });
    } finally {
      setLoading(false);
      setStreaming('');
      setMessages([...next, { role: 'assistant' as const, content: reply }]);
    }
  }

  return { messages, streaming, loading, send };
}
```

### Usage in a component

```tsx
function ChatUI() {
  const { messages, streaming, loading, send } = useChat('en');
  const [input, setInput] = useState('');

  return (
    <div>
      {messages.map((m, i) => (
        <div key={i} className={m.role === 'user' ? 'user' : 'assistant'}>
          {m.content}
        </div>
      ))}
      {streaming && <div className="assistant">{streaming}</div>}
      <input value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={() => { send(input); setInput(''); }} disabled={loading}>
        Send
      </button>
    </div>
  );
}
```

---

## Rate Limiting

- **10 requests per minute** per IP (shared with other endpoints)
- On `429`, show a message like *"Too many requests — please wait a moment."*
- The limit resets after 60 seconds

---

## `[DOWNLOAD_CV]` Marker

When the user asks for Omar's CV, the assistant reply will contain the literal string `[DOWNLOAD_CV]` on its own line. Detect it and render a download button instead.

```typescript
const hasCvMarker = reply.includes('[DOWNLOAD_CV]');
const displayText = reply.replace('[DOWNLOAD_CV]', '').trim();
```
