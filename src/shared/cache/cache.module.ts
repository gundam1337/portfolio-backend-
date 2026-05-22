import KeyvRedis from '@keyv/redis';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keyv } from 'keyv';
import type { Env } from '../../config/env.validation';

@Module({
  imports: [
    NestCacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const redisUrl = config.get('REDIS_URL', { infer: true });
        const ttl = config.get('CACHE_TTL', { infer: true });
        const stores: Keyv[] = redisUrl
          ? [new Keyv({ store: new KeyvRedis(redisUrl), namespace: 'cache' })]
          : [new Keyv({ namespace: 'cache' })];
        Logger.log(
          redisUrl
            ? 'Cache using Redis store via keyv'
            : 'REDIS_URL not set — cache using in-memory keyv store',
          'CacheModule',
        );
        return { ttl, stores };
      },
    }),
  ],
  exports: [NestCacheModule],
})
export class CacheModule {}
