import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SessionStore } from './session.store';
import type { Session } from './session.types';

// Every Redis key for a session uses this prefix so keys are namespaced and
// don't collide with cache or throttler keys stored on the same instance.
const KEY_PREFIX = 'session:';
// 1 hour — reset on every write so active conversations keep their TTL
const SESSION_TTL_SECONDS = 3600;

@Injectable()
export class RedisSessionStore extends SessionStore {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectPinoLogger(RedisSessionStore.name)
    private readonly logger: PinoLogger,
  ) {
    super();
  }

  private key(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
  }

  async get(sessionId: string): Promise<Session | null> {
    const raw = await this.redis.get(this.key(sessionId));
    if (raw === null) return null;

    try {
      return JSON.parse(raw) as Session;
    } catch {
      // Corrupted data in Redis — log and treat as cache miss so callers
      // create a fresh session rather than crashing.
      this.logger.warn(
        { sessionId },
        'session_parse_failed: corrupted JSON in Redis — treating as miss',
      );
      return null;
    }
  }

  async save(session: Session): Promise<void> {
    // SET key value EX seconds — atomically writes and resets TTL in one
    // round-trip.  Using EX (not PX) because session TTL is measured in hours.
    await this.redis.set(
      this.key(session.id),
      JSON.stringify(session),
      'EX',
      SESSION_TTL_SECONDS,
    );
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }
}
