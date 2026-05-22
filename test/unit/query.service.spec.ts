import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { QueryService } from '../../src/modules/query/query.service';
import type { QueryRequestDto } from '../../src/modules/query/dto/query-request.dto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('QueryService', () => {
  let service: QueryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryService,
        {
          provide: getLoggerToken(QueryService.name),
          useValue: { info: vi.fn(), error: vi.fn() },
        },
      ],
    }).compile();

    service = module.get<QueryService>(QueryService);
  });

  it('returns received status with requestId and question', () => {
    const dto: QueryRequestDto = { question: 'What stack does Omar use?' };
    const result = service.process(dto, 'test-request-id');

    expect(result).toEqual({
      requestId: 'test-request-id',
      status: 'received',
      question: 'What stack does Omar use?',
    });
  });
});
