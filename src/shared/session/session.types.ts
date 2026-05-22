// Pure domain types — no NestJS or ioredis imports.
// Kept in shared/ so both the store and the service import from one place.

export type MessageRole = 'user' | 'assistant';

export interface Message {
  role: MessageRole;
  content: string;
  // ISO 8601 string — stored as string so JSON serialisation is lossless
  timestamp: string;
}

export interface Session {
  id: string;
  messages: Message[];
  // ISO 8601 — set once at creation, never mutated
  createdAt: string;
  // ISO 8601 — updated by SessionService on every append
  updatedAt: string;
}
