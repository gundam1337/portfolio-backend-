import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { QueryRewriterService } from '../query-rewriter/query-rewriter.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { SessionService } from '../../shared/session/session.service';
import type { QueryRequestDto } from './dto/query-request.dto';
import type { QueryResponse } from './interfaces/query.interface';

@Injectable()
export class QueryService {
  constructor(
    @InjectPinoLogger(QueryService.name)
    private readonly logger: PinoLogger,
    private readonly sessionService: SessionService,
    private readonly queryRewriter: QueryRewriterService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async process(dto: QueryRequestDto, requestId: string): Promise<QueryResponse> {
    // 1. Load an existing session or create a fresh one
    const session = await this.sessionService.loadOrCreate(dto.conversationId);

    // 2. Capture history BEFORE appending so the rewriter sees only prior turns
    const historyBeforeAppend = await this.sessionService.getRecentHistory(session.id);

    // 3. Persist the user's message into history
    await this.sessionService.appendUserMessage(session.id, dto.question);

    // 4. Rewrite the question against the history that preceded it
    const rewriteResult = await this.queryRewriter.rewrite({
      originalQuestion: dto.question,
      history: historyBeforeAppend,
      requestId,
    });

    // 5. Embed the (rewritten) question — fails hard with 503 on OpenAI error
    const embedResult = await this.embeddingService.embed({
      text: rewriteResult.rewrittenQuestion,
      requestId,
    });

    // The full vector is available as embedResult.vector for the next pipeline step.
    // TODO Step 6: pass embedResult.vector into Qdrant similarity search

    // 6. Return the last ≤10 messages (includes the user message just appended)
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
