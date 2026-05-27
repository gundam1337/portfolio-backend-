import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Env } from '../../config/env.validation';

/** Injection token for the runtime QdrantClient (DI version for NestJS apps). */
export const QDRANT_CLIENT = 'QDRANT_CLIENT';

/**
 * NestJS provider that constructs a QdrantClient from ConfigService.
 * Kept separate from src/indexing/qdrant.client.ts (plain function for scripts)
 * so the runtime app and standalone indexing scripts stay independent.
 */
export const QdrantClientProvider = {
  provide: QDRANT_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): QdrantClient => {
    const url = config.get('QDRANT_URL', { infer: true });
    const apiKey = config.get('QDRANT_API_KEY', { infer: true });

    const urlHost = new URL(url).host;
    new Logger('QdrantClientProvider').log(`Connecting to Qdrant at ${urlHost}`);

    return new QdrantClient({ url, apiKey });
  },
};
