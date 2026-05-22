import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SessionService } from '../../shared/session/session.service';
import type { QueryRequestDto } from './dto/query-request.dto';
import type { QueryResponse } from './interfaces/query.interface';

@Injectable()
export class QueryService {
  constructor(
    @InjectPinoLogger(QueryService.name)
    private readonly logger: PinoLogger,
    private readonly sessionService: SessionService,
  ) {}

  async process(dto: QueryRequestDto, requestId: string): Promise<QueryResponse> {
    // 1. Load an existing session or create a fresh one
    const session = await this.sessionService.loadOrCreate(dto.conversationId);

    // 2. Persist the user's message into history
    await this.sessionService.appendUserMessage(session.id, dto.question);

    // 3. Return the last ≤10 messages (includes the user message just appended)
    const history = await this.sessionService.getRecentHistory(session.id);

    this.logger.info({ requestId, sessionId: session.id }, 'query_processed');

    return {
      requestId,
      conversationId: session.id,
      status: 'received',
      question: dto.question,
      history,
    };
  }
}
