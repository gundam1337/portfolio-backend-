import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { QueryRewriterService } from '../query-rewriter/query-rewriter.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { SessionService } from '../../shared/session/session.service';
import type { QueryRequestDto } from './dto/query-request.dto';
import type { QueryResponse } from './interfaces/query.interface';

@Injectable()
export class QueryService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly sessionService: SessionService,
    private readonly queryRewriter: QueryRewriterService,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.logger.setContext(QueryService.name);
  }

  async process(dto: QueryRequestDto, requestId: string): Promise<QueryResponse> {
    const session = await this.sessionService.loadOrCreate(dto.conversationId);
    const historyBeforeAppend = await this.sessionService.getRecentHistory(session.id);
    await this.sessionService.appendUserMessage(session.id, dto.question);

    const rewriteResult = await this.queryRewriter.rewrite({
      originalQuestion: dto.question,
      history: historyBeforeAppend,
      requestId,
    });

    const embedResult = await this.embeddingService.embed({
      text: rewriteResult.rewrittenQuestion,
      requestId,
    });

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
        preview: embedResult.vector.slice(0, 5),
      },
      history,
    };
  }
}
