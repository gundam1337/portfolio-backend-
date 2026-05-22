import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { QueryRequestDto } from './dto/query-request.dto';

interface QueryResponse {
  requestId: string;
  status: 'received';
  question: string;
}

@ApiTags('query')
@Controller('api/query')
export class QueryController {
  constructor(
    @InjectPinoLogger(QueryController.name)
    private readonly logger: PinoLogger,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: QueryRequestDto })
  @ApiOkResponse({ description: 'Query accepted for processing' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  query(@Body() dto: QueryRequestDto, @Req() req: FastifyRequest): QueryResponse {
    const requestId = req.id as string;
    this.logger.info({ requestId, question: dto.question }, 'received valid query');
    return { requestId, status: 'received', question: dto.question };
  }
}
