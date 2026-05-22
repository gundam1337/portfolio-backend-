import * as crypto from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import OpenAI from 'openai';
import type Redis from 'ioredis';
import type { Env } from '../../config/env.validation';
import { OPENAI_CLIENT } from '../../shared/openai/openai.constants';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
import { retryWithBackoff } from '../../utils/retry';
import type { CachedEmbedding, EmbedInput, EmbedResult } from './embedding.types';

const EMBED_CACHE_TTL_SECONDS = 86_400; // 24 h
const EMBED_TIMEOUT_MS = 10_000;

@Injectable()
export class EmbeddingService {
  private readonly model: string;
  private readonly dimensions: number;

  constructor(
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAI,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectPinoLogger(EmbeddingService.name)
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>,
  ) {
    this.model = config.get('OPENAI_EMBEDDING_MODEL', { infer: true });
    this.dimensions = config.get('OPENAI_EMBEDDING_DIMENSIONS', { infer: true });
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const { text, requestId } = input;
    const startMs = Date.now();

    // a. Input validation — never hit OpenAI with empty text
    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException('Embedding input must not be empty or whitespace.');
    }

    // b. Cache key: model + dimensions prevent cross-model collisions
    const hash = crypto.createHash('sha256').update(trimmed).digest('hex');
    const cacheKey = `embedding:${this.model}:${this.dimensions}:${hash}`;

    this.logger.debug(
      { requestId, textLength: trimmed.length, cacheKey },
      'embedding_started',
    );

    // c. Cache lookup
    const cached = await this.tryGetFromCache(cacheKey, requestId);
    if (cached !== null) {
      const durationMs = Date.now() - startMs;
      this.logger.info({ requestId, cacheKey, durationMs }, 'embedding_cache_hit');
      this.logger.debug({ requestId, cached: true, durationMs, dimensions: this.dimensions }, 'embedding_completed');
      return {
        vector: cached.vector,
        model: this.model,
        dimensions: this.dimensions,
        cached: true,
        durationMs,
      };
    }

    this.logger.debug({ requestId, cacheKey }, 'embedding_cache_miss');

    // d. Fresh embedding call with retry
    const vector = await this.fetchEmbedding(trimmed, requestId, startMs);

    // e. Cache the result
    const payload: CachedEmbedding = {
      vector,
      model: this.model,
      dimensions: this.dimensions,
      createdAt: new Date().toISOString(),
    };
    // Fire-and-forget — a cache write failure must not fail the request
    this.redis
      .set(cacheKey, JSON.stringify(payload), 'EX', EMBED_CACHE_TTL_SECONDS)
      .catch((err: Error) =>
        this.logger.warn({ requestId, cacheKey, error: err.message }, 'embedding_cache_write_failed'),
      );

    const durationMs = Date.now() - startMs;
    this.logger.debug(
      { requestId, cached: false, durationMs, dimensions: this.dimensions },
      'embedding_completed',
    );

    return { vector, model: this.model, dimensions: this.dimensions, cached: false, durationMs };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async tryGetFromCache(
    cacheKey: string,
    requestId: string,
  ): Promise<CachedEmbedding | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(cacheKey);
    } catch {
      // Redis down — proceed as cache miss
      return null;
    }

    if (raw === null) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !Array.isArray((parsed as CachedEmbedding).vector)
      ) {
        throw new Error('not an object with a vector array');
      }
      const entry = parsed as CachedEmbedding;
      if (entry.vector.length !== this.dimensions) {
        throw new Error(
          `expected ${this.dimensions} dimensions, got ${entry.vector.length}`,
        );
      }
      return entry;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn({ requestId, cacheKey, reason }, 'embedding_cache_corrupt');
      return null;
    }
  }

  private async fetchEmbedding(
    text: string,
    requestId: string,
    startMs: number,
  ): Promise<number[]> {
    const { model, dimensions } = this;

    try {
      const vector = await retryWithBackoff(
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

          try {
            const response = await this.openai.embeddings.create(
              { model, input: text, dimensions, encoding_format: 'float' },
              { signal: controller.signal },
            );

            const embedding = response.data[0]?.embedding;
            if (!Array.isArray(embedding) || embedding.length !== dimensions) {
              // Treat a malformed response as a non-retryable error
              const err = new Error(
                `OpenAI returned ${Array.isArray(embedding) ? embedding.length : 'no'} dimensions, expected ${dimensions}`,
              );
              // status undefined → defaultIsRetryable treats it as retryable;
              // assign a 4xx-like status so it is NOT retried
              (err as unknown as { status: number }).status = 422;
              throw err;
            }

            return embedding;
          } finally {
            clearTimeout(timer);
          }
        },
        { maxAttempts: 3, delaysMs: [1_000, 3_000] },
      );

      return vector;
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorClassName = err instanceof Error ? err.constructor.name : 'UnknownError';
      const status = (err as unknown as { status?: number }).status;

      this.logger.error(
        { requestId, error: errorClassName, durationMs },
        'embedding_failed',
      );

      // 4xx client errors (except the 422 we assigned above for dimension mismatch)
      // propagate as-is so callers get a clear signal; everything else → 503.
      if (typeof status === 'number' && status >= 400 && status < 500 && status !== 422 && status !== 429) {
        throw err;
      }

      throw new ServiceUnavailableException(
        'The embedding service is temporarily unavailable. Please try again shortly.',
      );
    }
  }
}
