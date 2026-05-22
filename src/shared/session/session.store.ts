import type { Session } from './session.types';

// Abstract class rather than an interface so NestJS can use it as a DI token.
// TypeScript interfaces are erased at runtime; abstract classes survive
// compilation and are valid tokens for `provide:` / `@Inject()`.
export abstract class SessionStore {
  // Returns null when the session doesn't exist or has expired (TTL elapsed).
  abstract get(sessionId: string): Promise<Session | null>;

  // Persist a session.  Every implementation MUST reset the TTL to 3600 s on
  // every write so active conversations don't expire mid-stream.
  abstract save(session: Session): Promise<void>;

  abstract delete(sessionId: string): Promise<void>;
}
