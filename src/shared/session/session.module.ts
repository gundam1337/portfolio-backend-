import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { RedisSessionStore } from './redis-session.store';
import { SessionService } from './session.service';
import { SessionStore } from './session.store';

@Module({
  imports: [
    // RedisModule exports the REDIS_CLIENT token that RedisSessionStore injects
    RedisModule,
  ],
  providers: [
    // Bind the abstract token to its concrete Redis-backed implementation.
    // Any module that imports SessionModule and injects SessionStore will get
    // RedisSessionStore without knowing Redis exists.
    {
      provide: SessionStore,
      useClass: RedisSessionStore,
    },
    SessionService,
  ],
  exports: [SessionService],
})
export class SessionModule {}
