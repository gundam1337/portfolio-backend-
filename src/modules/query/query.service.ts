import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { QueryRewriterService } from '../query-rewriter/query-rewriter.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { SessionService } from '../../shared/session/session.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import type { QueryRequestDto } from './dto/query-request.dto';
import type { QueryResponse } from './interfaces/query.interface';

const PREVIEW_MAX_CHARS = 200;
const TOP_RESULTS_COUNT = 5;

@Injectable()
export class QueryService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly sessionService: SessionService,
    private readonly queryRewriter: QueryRewriterService,
    private readonly embeddingService: EmbeddingService,
    private readonly retrievalService: RetrievalService,
  ) {
    this.logger.setContext(QueryService.name);
  }

  async process(dto: QueryRequestDto, requestId: string): Promise<QueryResponse> {
    const session = await this.sessionService.loadOrCreate(dto.conversationId);
    const historyBeforeAppend = await this.sessionService.getRecentHistory(session.id);
    await this.sessionService.appendUserMessage(session.id, dto.question);

    // Step 4: Query rewriting
    const rewriteResult = await this.queryRewriter.rewrite({
      originalQuestion: dto.question,
      history: historyBeforeAppend,
      requestId,
    });

    // Step 5: Embedding
    const embedResult = await this.embeddingService.embed({
      text: rewriteResult.rewrittenQuestion,
      requestId,
    });

    // Step 7: Vector search
    const retrieval = await this.retrievalService.search({
      queryVector: embedResult.vector,
      requestId,
    });

    // TODO Step 9+: reranking, prompt construction, and generation plug in here.
    // `retrieval.chunks` holds all top-K chunks for downstream steps.

    const history = await this.sessionService.getRecentHistory(session.id);

    this.logger.info({ requestId, sessionId: session.id }, 'query_processed');

    return {
      requestId,
      conversationId: session.id,
      originalQuestion: dto.question,
      rewrittenQuestion: rewriteResult.rewrittenQuestion,
      rewriteUsed: rewriteResult.rewriteUsed,
      fallbackReason: rewriteResult.fallbackReason,
      embedding: {
        model: embedResult.model,
        dimensions: embedResult.dimensions,
        cached: embedResult.cached,
        durationMs: embedResult.durationMs,
      },
      retrieval: {
        count: retrieval.chunks.length,
        topScore: retrieval.topScore,
        lowestScore: retrieval.lowestScore,
        lowConfidence: retrieval.lowConfidence,
        durationMs: retrieval.durationMs,
        topResults: retrieval.chunks.slice(0, TOP_RESULTS_COUNT).map((chunk) => ({
          score: chunk.score,
          sourceFile: chunk.sourceFile,
          headingPath: chunk.headingPath ?? null,
          pageNumber: chunk.pageNumber ?? null,
          preview: chunk.text.slice(0, PREVIEW_MAX_CHARS),
        })),
      },
      history,
    };
  }
}
