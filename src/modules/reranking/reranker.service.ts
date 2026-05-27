import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { CohereClientV2 } from 'cohere-ai';
import { COHERE_CLIENT } from '../../shared/cohere/cohere.constants';
import type { Env } from '../../config/env.validation';
import { retryWithBackoff } from '../../utils/retry';
import type { RetrievedChunk } from '../retrieval/retrieval.types';
import type { RerankedChunk, RerankResult } from './reranker.types';

interface CohereRerankResultItem { index: number; relevanceScore: number; }

const RERANK_TIMEOUT_MS = 5_000;

interface RerankInput {
  query: string;
  chunks: RetrievedChunk[];
  lowConfidence: boolean;
  requestId: string;
}

@Injectable()
export class RerankerService {
  private readonly model: string;
  private readonly topN: number;

  constructor(
    @Inject(COHERE_CLIENT) private readonly cohereClient: CohereClientV2,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(RerankerService.name);
    this.model = config.get('COHERE_RERANK_MODEL', { infer: true });
    this.topN = config.get('RERANK_TOP_N', { infer: true });
  }

  async rerank(input: RerankInput): Promise<RerankResult> {
    const { query, chunks, lowConfidence, requestId } = input;

    if (lowConfidence || chunks.length === 0) {
      this.logger.debug({ requestId, reason: 'low_confidence' }, 'reranking_skipped');
      return { chunks: [], used: false, model: null, durationMs: 0, fallbackReason: 'low_confidence' };
    }

    this.logger.debug(
      { requestId, candidateCount: chunks.length, query: '[redacted]' },
      'reranking_started',
    );

    const startMs = Date.now();

    try {
      const response = await retryWithBackoff(
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);
          try {
            return await this.cohereClient.rerank(
              { model: this.model, query, documents: chunks.map((c) => c.text), topN: this.topN },
              { abortSignal: controller.signal },
            );
          } finally {
            clearTimeout(timer);
          }
        },
        {
          maxAttempts: 3,
          delaysMs: [1_000, 3_000],
          isRetryable: (err) => {
            if (err instanceof Error && err.name === 'AbortError') return true;
            const status = (err as { status?: number }).status;
            if (typeof status === 'number') return status === 429 || status >= 500;
            return true;
          },
        },
      );

      const durationMs = Date.now() - startMs;

      if (!Array.isArray(response.results)) {
        this.logger.warn({ requestId, reason: 'results_not_array', durationMs }, 'reranking_fallback');
        return this.buildFallback(chunks, 'invalid_response', durationMs);
      }

      for (const r of response.results as CohereRerankResultItem[]) {
        if (typeof r.index !== 'number' || typeof r.relevanceScore !== 'number') {
          this.logger.warn(
            { requestId, reason: 'invalid_result_shape', durationMs },
            'reranking_fallback',
          );
          return this.buildFallback(chunks, 'invalid_response', durationMs);
        }
      }

      const reranked: RerankedChunk[] = (response.results as CohereRerankResultItem[]).map((r) => ({
        ...chunks[r.index],
        rerankerScore: r.relevanceScore,
        vectorScore: chunks[r.index].score,
      }));

      const topScore = reranked[0]?.rerankerScore ?? null;
      const lowestScore = reranked[reranked.length - 1]?.rerankerScore ?? null;

      this.logger.info(
        { requestId, used: true, durationMs, topScore, lowestScore, fallbackReason: null },
        'reranking_completed',
      );

      return { chunks: reranked, used: true, model: this.model, durationMs, fallbackReason: null };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const fallbackReason =
        err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'api_error';
      this.logger.warn({ requestId, fallbackReason, errorClass, durationMs }, 'reranking_fallback');
      return this.buildFallback(chunks, fallbackReason, durationMs);
    }
  }

  private buildFallback(
    chunks: RetrievedChunk[],
    fallbackReason: RerankResult['fallbackReason'],
    durationMs: number,
  ): RerankResult {
    const topN = chunks.slice(0, this.topN).map(
      (c): RerankedChunk => ({ ...c, rerankerScore: c.score, vectorScore: c.score }),
    );
    return { chunks: topN, used: false, model: null, durationMs, fallbackReason };
  }
}
