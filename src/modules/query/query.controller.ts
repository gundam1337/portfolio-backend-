import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UsePipes,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { QueryRequestDto } from './dto/query-request.dto';
import { InputGuardService } from './input-guard.service';
import { SanitizationPipe } from './pipes/sanitization.pipe';
import { QueryService } from './query.service';
import type { QueryResponse } from './interfaces/query.interface';

@ApiTags('query')
@Controller('api/query')
export class QueryController {
  constructor(
    private readonly queryService: QueryService,
    private readonly inputGuard: InputGuardService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  // NestJS pipes run in registration order: the global ValidationPipe fires
  // first (registered in AppModule), then SanitizationPipe fires second.
  // Result: the DTO arrives here already type-validated AND sanitized.
  @UsePipes(SanitizationPipe)
  @ApiBody({ type: QueryRequestDto })
  @ApiOkResponse({ description: 'Query accepted for processing' })
  @ApiBadRequestResponse({ description: 'Validation or guard failed' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async query(
    @Body() dto: QueryRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<QueryResponse> {
    // InputGuardService runs after sanitization — checks semantic validity
    // of the cleaned string before it touches the session or RAG pipeline.
    this.inputGuard.validateQuestion(dto.question);

    return this.queryService.process(dto, req.id as string);
  }
}
