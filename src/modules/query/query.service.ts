import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { QueryRewriterService } from '../query-rewriter/query-rewriter.service';
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

    // 5. Return the last ≤10 messages (includes the user message just appended)
    const history = await this.sessionService.getRecentHistory(session.id);

    this.logger.info({ requestId, sessionId: session.id }, 'query_processed');

    // TODO Step 5+: pass rewriteResult.rewrittenQuestion into the retrieval pipeline

    return {
      requestId,
      conversationId: session.id,
      originalQuestion: dto.question,
      rewrittenQuestion: rewriteResult.rewrittenQuestion,
      rewriteUsed: rewriteResult.rewriteUsed,
      fallbackReason: rewriteResult.fallbackReason,
      history,
    };
  }
}
