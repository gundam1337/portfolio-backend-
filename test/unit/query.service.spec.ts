import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryService } from '../../src/modules/query/query.service';
import type { QueryRequestDto } from '../../src/modules/query/dto/query-request.dto';
import { SessionService } from '../../src/shared/session/session.service';
import { QueryRewriterService } from '../../src/modules/query-rewriter/query-rewriter.service';

const NOW = '2024-01-01T00:00:00.000Z';

function makeSession(id = 'session-id') {
  return { id, messages: [], createdAt: NOW, updatedAt: NOW };
}

describe('QueryService', () => {
  let service: QueryService;
  let mockSessionService: Record<string, ReturnType<typeof vi.fn>>;
  let mockRewriter: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    const session = makeSession();

    mockSessionService = {
      loadOrCreate: vi.fn().mockResolvedValue(session),
      appendUserMessage: vi.fn().mockResolvedValue(session),
      appendAssistantMessage: vi.fn().mockResolvedValue(session),
      getRecentHistory: vi.fn().mockResolvedValue([]),
    };

    mockRewriter = {
      rewrite: vi.fn().mockResolvedValue({
        rewrittenQuestion: 'What stack does Omar use?',
        rewriteUsed: false,
        fallbackReason: null,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryService,
        {
          provide: getLoggerToken(QueryService.name),
          useValue: { info: vi.fn(), error: vi.fn() },
        },
        {
          provide: SessionService,
          useValue: mockSessionService,
        },
        {
          provide: QueryRewriterService,
          useValue: mockRewriter,
        },
      ],
    }).compile();

    service = module.get<QueryService>(QueryService);
  });

  it('returns requestId, conversationId, originalQuestion, rewrittenQuestion, rewriteUsed, fallbackReason, and history', async () => {
    const dto: QueryRequestDto = { question: 'What stack does Omar use?' };
    const result = await service.process(dto, 'test-request-id');

    expect(result).toEqual({
      requestId: 'test-request-id',
      conversationId: 'session-id',
      originalQuestion: 'What stack does Omar use?',
      rewrittenQuestion: 'What stack does Omar use?',
      rewriteUsed: false,
      fallbackReason: null,
      history: [],
    });
  });

  it('calls loadOrCreate with the provided conversationId', async () => {
    const dto: QueryRequestDto = {
      question: 'Follow-up question',
      conversationId: 'existing-id',
    };

    await service.process(dto, 'req-id');

    expect(mockSessionService.loadOrCreate).toHaveBeenCalledWith('existing-id');
  });

  it('appends the user message before returning', async () => {
    const dto: QueryRequestDto = { question: 'Hello' };
    await service.process(dto, 'req-id');

    expect(mockSessionService.appendUserMessage).toHaveBeenCalledWith(
      'session-id',
      'Hello',
    );
  });
});
