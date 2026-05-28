import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import OpenAI from 'openai';
import type { Env } from '../../config/env.validation';
import { OPENAI_CLIENT } from '../../shared/openai/openai.constants';
import { retryWithBackoff } from '../../utils/retry';
import type { EmbedInput, EmbedResult } from './embedding.types';

const EMBED_TIMEOUT_MS = 10_000;

@Injectable()
export class EmbeddingService {
  private readonly model: string;
  private readonly dimensions: number;

  constructor(
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAI,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(EmbeddingService.name);
    this.model = config.get('OPENAI_EMBEDDING_MODEL', { infer: true });
    this.dimensions = config.get('OPENAI_EMBEDDING_DIMENSIONS', { infer: true });
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const { text, requestId } = input;
    const startMs = Date.now();

    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException('Embedding input must not be empty or whitespace.');
    }

    this.logger.debug(
      { requestId, textLength: trimmed.length },
      'embedding_started',
    );

    const vector = await this.fetchEmbedding(trimmed, requestId, startMs);

    const durationMs = Date.now() - startMs;
    this.logger.debug(
      { requestId, durationMs, dimensions: this.dimensions },
      'embedding_completed',
    );

    return { vector, model: this.model, dimensions: this.dimensions, durationMs };
  }

  private async fetchEmbedding(
    text: string,
    requestId: string,
    startMs: number,
  ): Promise<number[]> {
    const { model, dimensions } = this;

    try {
      return await retryWithBackoff(
        async () => {
          const response = await this.openai.embeddings.create(
            { model, input: text, dimensions, encoding_format: 'float' },
            { timeout: EMBED_TIMEOUT_MS },
          );

          const embedding = response.data[0]?.embedding;
          if (!Array.isArray(embedding) || embedding.length !== dimensions) {
            throw new BadRequestException(
              `OpenAI returned ${Array.isArray(embedding) ? embedding.length : 'no'} dimensions, expected ${dimensions}`,
            );
          }

          return embedding;
        },
        {
          maxAttempts: 3,
          delaysMs: [1_000, 3_000],
          isRetryable: (err) => !(err instanceof BadRequestException),
        },
      );
    } catch (err) {
      if (err instanceof BadRequestException) throw err;

      this.logger.error(
        {
          requestId,
          error: err instanceof Error ? err.constructor.name : 'UnknownError',
          durationMs: Date.now() - startMs,
        },
        'embedding_failed',
      );

      throw new ServiceUnavailableException(
        'The embedding service is temporarily unavailable. Please try again shortly.',
      );
    }
  }
}
