import {
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Env } from '../../config/env.validation';
import { retryWithBackoff } from '../../utils/retry';
import { QDRANT_CLIENT } from './qdrant.client.provider';
import type { RetrievalResult, RetrievedChunk } from './retrieval.types';

const SEARCH_TIMEOUT_MS = 10_000;

interface SearchInput {
  queryVector: number[];
  requestId: string;
}

@Injectable()
export class RetrievalService {
  private readonly collection: string;
  private readonly topK: number;
  private readonly scoreFloor: number;
  private readonly expectedDimensions: number;

  constructor(
    @Inject(QDRANT_CLIENT) private readonly qdrant: QdrantClient,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(RetrievalService.name);
    this.collection = config.get('QDRANT_COLLECTION', { infer: true });
    this.topK = config.get('RETRIEVAL_TOP_K', { infer: true });
    this.scoreFloor = config.get('RETRIEVAL_SCORE_FLOOR', { infer: true });
    this.expectedDimensions = config.get('OPENAI_EMBEDDING_DIMENSIONS', { infer: true });
  }

  async search(input: SearchInput): Promise<RetrievalResult> {
    const { queryVector, requestId } = input;
    const startMs = Date.now();

    // a. Validate query vector
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      throw new InternalServerErrorException(
        'Query vector must be a non-empty array of numbers.',
      );
    }
    if (queryVector.length !== this.expectedDimensions) {
      throw new InternalServerErrorException(
        `Query vector has ${queryVector.length} dimensions but OPENAI_EMBEDDING_DIMENSIONS is set to ${this.expectedDimensions}. This is a configuration bug.`,
      );
    }

    this.logger.debug(
      {
        requestId,
        collection: this.collection,
        topK: this.topK,
        scoreFloor: this.scoreFloor,
        queryDimensions: queryVector.length,
      },
      'retrieval_started',
    );

    // b. Call Qdrant with retry
    let rawPoints: Awaited<ReturnType<QdrantClient['search']>>;
    try {
      rawPoints = await retryWithBackoff(() =>
        this.qdrant.search(this.collection, {
          vector: queryVector,
          limit: this.topK,
          with_payload: true,
          with_vector: false,
          filter: undefined,
          timeout: SEARCH_TIMEOUT_MS / 1000,
        }),
      );
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const status = (err as { status?: number }).status;

      this.logger.error(
        { requestId, attempt: 3, errorClass, durationMs },
        'retrieval_failed',
      );

      if (typeof status === 'number' && status === 401) {
        // 401 → bad API key — config bug, not user error
        throw new InternalServerErrorException(
          'Qdrant authentication failed. Check QDRANT_API_KEY configuration.',
        );
      }

      throw new ServiceUnavailableException(
        'The retrieval service is temporarily unavailable. Please try again shortly.',
      );
    }

    // c. Validate and map each returned point
    const chunks: RetrievedChunk[] = [];
    for (const point of rawPoints) {
      const payload = point.payload as Record<string, unknown> | undefined;

      if (!this.isValidPayload(payload)) {
        this.logger.warn(
          { requestId, pointId: point.id, reason: 'missing or invalid required payload fields' },
          'retrieval_point_skipped',
        );
        continue;
      }

      chunks.push({
        id: point.id,
        score: point.score,
        text: payload['text'] as string,
        sourceFile: payload['sourceFile'] as string,
        sourceType: payload['sourceType'] as 'markdown' | 'pdf',
        chunkIndex: payload['chunkIndex'] as number,
        totalChunks: payload['totalChunks'] as number,
        pageNumber: typeof payload['pageNumber'] === 'number' ? payload['pageNumber'] : undefined,
        headingPath: Array.isArray(payload['headingPath'])
          ? (payload['headingPath'] as string[])
          : undefined,
      });
    }

    // d. Compute result summary
    const topScore = chunks.length > 0 ? chunks[0].score : null;
    const lowestScore = chunks.length > 0 ? chunks[chunks.length - 1].score : null;
    const lowConfidence = chunks.length === 0 || topScore === null || topScore < this.scoreFloor;
    const durationMs = Date.now() - startMs;

    this.logger.info(
      { requestId, count: chunks.length, topScore, lowestScore, lowConfidence, durationMs },
      'retrieval_completed',
    );

    // Full chunk payloads only at TRACE — keep INFO terminal scannable
    this.logger.trace(
      {
        requestId,
        chunks: chunks.map((c) => ({
          id: c.id,
          score: c.score,
          source: c.sourceFile,
          text: c.text.slice(0, 120),
        })),
      },
      'retrieval_chunks',
    );

    this.logger.info(
      {
        requestId,
        count: chunks.length,
        chunks
      },
      'retrieval_summary',
    );

    return {
      chunks,
      topScore,
      lowestScore,
      lowConfidence,
      durationMs,
      queryDimensions: queryVector.length,
    };
  }

  private isValidPayload(
    payload: Record<string, unknown> | undefined,
  ): payload is Record<string, unknown> {
    if (!payload) return false;
    return (
      typeof payload['text'] === 'string' &&
      typeof payload['sourceFile'] === 'string' &&
      (payload['sourceType'] === 'markdown' || payload['sourceType'] === 'pdf') &&
      typeof payload['chunkIndex'] === 'number' &&
      typeof payload['totalChunks'] === 'number'
    );
  }
}
