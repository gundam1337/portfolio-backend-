import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { QueryResponse } from './interfaces/query.interface';
import type { QueryRequestDto } from './dto/query-request.dto';

@Injectable()
export class QueryService {
  constructor(
    @InjectPinoLogger(QueryService.name)
    private readonly logger: PinoLogger,
  ) {}

  process(dto: QueryRequestDto, requestId: string): QueryResponse {
    this.logger.info({ requestId, question: dto.question }, 'received valid query');
    return { requestId, status: 'received', question: dto.question };
  }
}
