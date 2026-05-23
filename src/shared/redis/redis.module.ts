import { Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import Redis from 'ioredis';
import type { Env } from '../../config/env.validation';
import { REDIS_CLIENT } from './redis.constants';

// Factory function kept outside the class so it has a clear return type
// and is independently testable without instantiating the module.
function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: false,
    enableReadyCheck: true,
    // Fail fast: if Redis is unreachable, surface an error immediately
    // instead of queuing commands indefinitely and hanging the request.
    connectTimeout: 3_000,
    // 0 = do not retry failed commands while disconnected — throw immediately
    // so the caller gets a 503 rather than a silent hang.
    maxRetriesPerRequest: 0,
  });

  const logger = new Logger('RedisClient');

  client.on('connect', () => logger.log('Redis connection established'));
  client.on('ready', () => logger.log('Redis client ready'));
  // Log but don't rethrow — ioredis auto-reconnects; a single error shouldn't
  // crash the app.  The global AllExceptionsFilter will catch any
  // downstream failures that bubble up through request handlers.
  client.on('error', (err: Error) =>
    logger.error({ err: err.message }, 'Redis client error'),
  );
  client.on('close', () => logger.warn('Redis connection closed'));
  client.on('reconnecting', () => logger.warn('Redis reconnecting…'));

  return client;
}

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      // ConfigService<Env, true> — the second generic arg (`true`) tells TS
      // that every key is guaranteed to exist after validation, so .get()
      // returns T rather than T | undefined.
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis => {
        const url = config.get('REDIS_URL', { infer: true });
        return createRedisClient(url);
      },
    },
  ],
  // Export the token so any module that imports RedisModule can @Inject(REDIS_CLIENT)
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  // Called by NestJS during graceful shutdown (app.close() / SIGTERM).
  // Quits the connection cleanly so in-flight commands complete before the
  // process exits, rather than hard-closing the TCP socket.
  async onModuleDestroy(): Promise<void> {
    const client = this.moduleRef.get<Redis>(REDIS_CLIENT, { strict: false });
    if (client) {
      await client.quit();
      this.logger.log('Redis client disconnected (module destroy)');
    }
  }
}
