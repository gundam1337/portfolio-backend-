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

const RERANKER_WEIGHT = 0.3;

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

    const results = response.results as CohereRerankResultItem[];

    const rerankerScores = results.map((r) => r.relevanceScore);
    const vectorScores = results.map((r) => chunks[r.index].score);

    const rerankerMin = Math.min(...rerankerScores);
    const rerankerMax = Math.max(...rerankerScores);
    const vectorMin = Math.min(...vectorScores);
    const vectorMax = Math.max(...vectorScores);

    const normalize = (val: number, min: number, max: number) =>
      max === min ? 1 : 0.1 + 0.9 * (val - min) / (max - min);

    const reranked: RerankedChunk[] = results
      .map((r) => {
        const chunk = chunks[r.index];
        const normReranker = normalize(r.relevanceScore, rerankerMin, rerankerMax);
        const normVector = normalize(chunk.score, vectorMin, vectorMax);
        const hybridScore = RERANKER_WEIGHT * normReranker + (1 - RERANKER_WEIGHT) * normVector;
        return {
          ...chunk,
          score: hybridScore,
          rerankerScore: r.relevanceScore,
          vectorScore: chunk.score,
        };
      })
      .sort((a, b) => b.score - a.score);

    const topScore = reranked[0]?.score ?? null;
    const lowestScore = reranked[reranked.length - 1]?.score ?? null;

    this.logger.info(
      { requestId, durationMs, topScore, lowestScore },
      'reranking_completed',
    );

    return { chunks: reranked, used: true, model: this.model, durationMs, fallbackReason: null };
  }
}
