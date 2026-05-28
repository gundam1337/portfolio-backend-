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

interface RerankInput {
  query: string;
  chunks: RetrievedChunk[];
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
    const { query, chunks, requestId } = input;

    this.logger.debug(
      { requestId, candidateCount: chunks.length, query: '[redacted]' },
      'reranking_started',
    );

    const startMs = Date.now();

    const response = await retryWithBackoff(
      () => this.cohereClient.rerank(
        { model: this.model, query, documents: chunks.map((c) => c.text), topN: this.topN },
      ),
      { maxAttempts: 3, delaysMs: [1_000, 3_000] },
    );

    const durationMs = Date.now() - startMs;

    if (!Array.isArray(response.results)) {
      throw new Error('Cohere rerank response.results is not an array');
    }

    for (const r of response.results as CohereRerankResultItem[]) {
      if (typeof r.index !== 'number' || typeof r.relevanceScore !== 'number') {
        throw new Error('Cohere rerank result item has invalid shape');
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
      { requestId, durationMs, topScore, lowestScore },
      'reranking_completed',
    );

    return { chunks: reranked, used: true, model: this.model, durationMs, fallbackReason: null };
  }
}
