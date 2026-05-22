import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { setupSwagger } from './config/swagger.config';
import { Logger } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // nestjs-pino owns all logging — Fastify's built-in pino is disabled
      logger: false,
      // Render sits behind a load balancer; this makes req.ip reflect the real
      // client IP from X-Forwarded-For rather than the proxy's address
      trustProxy: true,
      // Override Fastify's default integer request IDs with UUIDs so every
      // log line and response header carries a globally unique trace ID.
      // Reuses an upstream X-Request-ID header when present (proxy / service mesh).
      genReqId: (req: IncomingMessage): string => {
        const upstream = req.headers['x-request-id'];
        return typeof upstream === 'string' && upstream.length > 0
          ? upstream
          : uuidv4();
      },
    }),
    // Buffer early bootstrap logs until the pino logger is wired below
    { bufferLogs: true },
  );

  // Wire nestjs-pino as the NestJS application logger.
  // Must be called immediately after create() so buffered logs are flushed.
  app.useLogger(app.get(Logger));

  // Set X-Request-ID on every response so clients can correlate by trace ID.
  // onSend fires after the route handler but before bytes hit the wire.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (request, reply) => {
    void reply.header('X-Request-ID', request.id);
  });

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const frontendUrl = config.get('FRONTEND_URL', { infer: true });

  await app.register(helmet);
  await app.register(cors, {
    origin: nodeEnv === 'production' ? frontendUrl : true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  setupSwagger(app);

  await app.listen(port, '0.0.0.0');
  app
    .get(Logger)
    .log(
      `Listening on http://localhost:${port} — docs at /docs`,
      'Bootstrap',
    );
}

void bootstrap();
