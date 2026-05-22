import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from './session.service';
import { SessionStore } from './session.store';
import type { Session } from './session.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = new Date().toISOString();
  return {
    id: 'test-session-id',
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Build a minimal mock SessionStore so tests never touch Redis
function makeMockStore(): SessionStore & {
  get: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionStore & {
    get: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

// Minimal pino logger stub — SessionService logs but tests don't assert on it
function makeMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function buildService(store: SessionStore) {
  // @ts-expect-error — injecting private logger stub without DI
  const svc = new SessionService(store, makeMockLogger());
  return svc;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SessionService', () => {
  let store: ReturnType<typeof makeMockStore>;
  let service: SessionService;

  beforeEach(() => {
    store = makeMockStore();
    service = buildService(store);
  });

  // ── loadOrCreate ──────────────────────────────────────────────────────────

  describe('loadOrCreate', () => {
    it('creates a new session when no conversationId is provided', async () => {
      const session = await service.loadOrCreate();

      expect(session.id).toBeTruthy();
      expect(session.messages).toHaveLength(0);
      // Should have persisted the new session immediately
      expect(store.save).toHaveBeenCalledOnce();
      expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }));
    });

    it('returns the existing session when the ID is found in the store', async () => {
      const existing = makeSession({ id: 'known-id', messages: [] });
      store.get.mockResolvedValue(existing);

      const session = await service.loadOrCreate('known-id');

      expect(session).toBe(existing);
      // No new session was persisted — only a read
      expect(store.save).not.toHaveBeenCalled();
    });

    it('creates a new session when the provided ID is not found (expired_or_missing)', async () => {
      store.get.mockResolvedValue(null); // simulates expired / non-existent key

      const session = await service.loadOrCreate('ghost-id');

      expect(session.id).not.toBe('ghost-id'); // fresh UUID, not the unknown one
      expect(store.save).toHaveBeenCalledOnce();
    });
  });

  // ── appendUserMessage ─────────────────────────────────────────────────────

  describe('appendUserMessage', () => {
    it('trims to the last 10 messages when history exceeds the limit', async () => {
      const now = new Date().toISOString();
      // Seed the session with 10 existing messages
      const existingMessages = Array.from({ length: 10 }, (_, i) => ({
        role: 'user' as const,
        content: `msg ${i}`,
        timestamp: now,
      }));
      const session = makeSession({ messages: existingMessages });
      store.get.mockResolvedValue(session);

      const updated = await service.appendUserMessage(session.id, 'eleventh message');

      // Total must never exceed 10
      expect(updated.messages).toHaveLength(10);
      // The oldest message was dropped; the new one is last
      expect(updated.messages[9].content).toBe('eleventh message');
      expect(updated.messages[0].content).toBe('msg 1'); // msg 0 was evicted
    });

    it('updates updatedAt on every append', async () => {
      const originalTime = '2024-01-01T00:00:00.000Z';
      const session = makeSession({ updatedAt: originalTime });
      store.get.mockResolvedValue(session);

      const updated = await service.appendUserMessage(session.id, 'hello');

      expect(updated.updatedAt).not.toBe(originalTime);
      // Must be a valid ISO 8601 string
      expect(() => new Date(updated.updatedAt)).not.toThrow();
    });
  });
});
