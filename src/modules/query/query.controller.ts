import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { QueryRequestDto } from './dto/query-request.dto';
import { QueryService } from './query.service';
import type { QueryResponse } from './interfaces/query.interface';

@ApiTags('query')
@Controller('api/query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: QueryRequestDto })
  @ApiOkResponse({ description: 'Query accepted for processing' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  query(@Body() dto: QueryRequestDto, @Req() req: FastifyRequest): QueryResponse {
    return this.queryService.process(dto, req.id as string);
  }
}
