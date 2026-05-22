import KeyvRedis from '@keyv/redis';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { CacheModule } from '@nestjs/cache-manager';
import { BadRequestException, Logger, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { Keyv } from 'keyv';
import { AcceptLanguageResolver, I18nModule, QueryResolver } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';
import * as path from 'path';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CustomThrottlerGuard } from './common/guards/throttler.guard';
import { validateEnv, type Env } from './config/env.validation';
import { AboutModule } from './modules/about/about.module';
import { HealthModule } from './modules/health/health.module';
import { QueryModule } from './modules/query/query.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
        return {
          pinoHttp: {
            level: isProd ? 'info' : 'debug',
            // pino-pretty for human-readable local logs; raw JSON in production
            // so log aggregators (Datadog, CloudWatch, Loki) can parse it
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { colorize: true, singleLine: true },
                },
            // Pull request.id (set via genReqId in main.ts) into every log line
            customProps: (req: import('http').IncomingMessage & { id?: string }) => ({
              requestId: req.id,
            }),
            autoLogging: true,
            serializers: {
              req: (req: Record<string, unknown>) => ({
                id: req['id'],
                method: req['method'],
                url: req['url'],
              }),
            },
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const redisUrl = config.get('REDIS_URL', { infer: true });
        const throttlers = [
          {
            name: 'per-minute',
            ttl: 60_000,
            limit: config.get('THROTTLE_MINUTE_LIMIT', { infer: true }),
          },
          {
            name: 'per-hour',
            ttl: config.get('THROTTLE_HOUR_TTL', { infer: true }),
            limit: config.get('THROTTLE_HOUR_LIMIT', { infer: true }),
          },
        ];
        if (redisUrl) {
          Logger.log('Throttler using Redis storage', 'AppModule');
          return {
            throttlers,
            storage: new ThrottlerStorageRedisService(redisUrl),
          };
        }
        Logger.warn(
          'REDIS_URL not set — throttler using in-memory storage (per-instance, resets on restart)',
          'AppModule',
        );
        return { throttlers };
      },
    }),
    CacheModule.registerAsync({
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
          'AppModule',
        );
        return { ttl, stores };
      },
    }),
    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loaderOptions: {
        path: path.join(__dirname, '/i18n/'),
        watch: true,
      },
      resolvers: [
        { use: QueryResolver, options: ['lang'] },
        AcceptLanguageResolver,
      ],
    }),
    HealthModule,
    AboutModule,
    QueryModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          exceptionFactory: (errors) => {
            const messages = errors
              .map((e) => Object.values(e.constraints ?? {}).join(', '))
              .join('; ');
            return new BadRequestException(messages);
          },
        }),
    },
  ],
})
export class AppModule {}
