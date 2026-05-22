import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { SessionStore } from './session.store';
import type { Message, Session } from './session.types';

// Maximum number of messages retained per session.  Older messages are
// dropped from the front of the array when this limit is exceeded.
const MAX_HISTORY = 10;

@Injectable()
export class SessionService {
  constructor(
    private readonly store: SessionStore,
    @InjectPinoLogger(SessionService.name)
    private readonly logger: PinoLogger,
  ) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  async loadOrCreate(conversationId?: string): Promise<Session> {
    if (conversationId) {
      const existing = await this.store.get(conversationId);
      if (existing) {
        this.logger.info(
          { sessionId: existing.id, messageCount: existing.messages.length },
          'session_loaded',
        );
        return existing;
      }
      // The ID was provided but not found in the store — either it expired or
      // it was never valid.  Create a fresh session rather than erroring so
      // the caller always gets a usable session back.
      this.logger.info(
        { sessionId: conversationId },
        'session_created: reason=expired_or_missing',
      );
    }

    const session = this.createEmptySession();
    await this.store.save(session);
    this.logger.info(
      { sessionId: session.id },
      conversationId
        ? 'session_created: reason=expired_or_missing'
        : 'session_created: reason=new',
    );
    return session;
  }

  async appendUserMessage(sessionId: string, content: string): Promise<Session> {
    return this.appendMessage(sessionId, 'user', content);
  }

  async appendAssistantMessage(
    sessionId: string,
    content: string,
  ): Promise<Session> {
    return this.appendMessage(sessionId, 'assistant', content);
  }

  async getRecentHistory(
    sessionId: string,
    limit: number = MAX_HISTORY,
  ): Promise<Message[]> {
    const session = await this.store.get(sessionId);
    if (!session) return [];
    // slice(-limit) returns the last `limit` items, oldest first
    return session.messages.slice(-limit);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private createEmptySession(): Session {
    const now = new Date().toISOString();
    return {
      id: uuidv4(),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  private async appendMessage(
    sessionId: string,
    role: Message['role'],
    content: string,
  ): Promise<Session> {
    // Re-fetch on every append so concurrent requests don't clobber each
    // other's writes (last-write-wins is acceptable for a chat history of
    // this scale; a full CRDT/transaction is premature here).
    const session = await this.store.get(sessionId);
    if (!session) {
      // Should not normally happen — the controller calls loadOrCreate first.
      // If it does, treat it as a bug and throw clearly.
      throw new Error(`Session not found for append: ${sessionId}`);
    }

    const message: Message = {
      role,
      content,
      timestamp: new Date().toISOString(),
    };

    session.messages.push(message);

    // Trim to the last MAX_HISTORY messages from the front so memory is
    // bounded.  Trimming lives here (service), NOT in the store, so the
    // store stays a dumb persistence layer.
    if (session.messages.length > MAX_HISTORY) {
      session.messages = session.messages.slice(-MAX_HISTORY);
    }

    session.updatedAt = new Date().toISOString();

    await this.store.save(session);

    // Privacy: never log message content
    this.logger.info(
      { sessionId, role, totalMessages: session.messages.length },
      'message_appended',
    );

    return session;
  }
}
