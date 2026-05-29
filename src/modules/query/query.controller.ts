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
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { QueryRequestDto } from './dto/query-request.dto';
import { QueryResponseDto } from './dto/query-response.dto';
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
  @UsePipes(SanitizationPipe)
  @ApiOperation({
    summary: 'Ask a question about Omar\'s portfolio',
    description: `
Runs the full **RAG pipeline** and returns a grounded answer with cited sources.

**Pipeline stages:**
1. **Rewrite** — semantically expands the question for better retrieval
2. **Embed** — vectorises the rewritten query
3. **Retrieve** — fetches top-k chunks from Qdrant
4. **Rerank** — Cohere reranks the candidates by relevance
5. **Generate** — Claude composes a Markdown answer grounded in the sources

**Conversation threads:**
Omit \`conversationId\` to start a new thread. Include it (from a previous response)
to continue an existing conversation with full history context.

**Rate limiting:** sliding-window per IP, backed by Redis.
    `.trim(),
  })
  @ApiHeader({
    name: 'X-Request-ID',
    description: 'Optional client-supplied trace ID. Echoed back in the response header.',
    required: false,
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @ApiBody({
    type: QueryRequestDto,
    examples: {
      new_conversation: {
        summary: 'Start a new conversation',
        value: { question: 'What technologies does Omar use in his portfolio?' },
      },
      continue_conversation: {
        summary: 'Continue an existing thread',
        value: {
          question: 'What about his backend experience specifically?',
          conversationId: '550e8400-e29b-41d4-a716-446655440000',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Answer generated successfully.',
    type: QueryResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed (missing question, invalid UUID, etc.) or input guard rejected the question.',
    schema: {
      example: {
        statusCode: 400,
        message: ['question must be longer than or equal to 1 characters'],
        error: 'Bad Request',
      },
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded. Retry after the window resets.',
    schema: {
      example: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
    },
  })
  async query(
    @Body() dto: QueryRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<QueryResponse> {
    this.inputGuard.validateQuestion(dto.question);
    return this.queryService.process(dto, req.id as string);
  }
}
