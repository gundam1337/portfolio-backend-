import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryService } from '../../src/modules/query/query.service';
import type { QueryRequestDto } from '../../src/modules/query/dto/query-request.dto';
import { SessionService } from '../../src/shared/session/session.service';
import { QueryRewriterService } from '../../src/modules/query-rewriter/query-rewriter.service';
import { EmbeddingService } from '../../src/modules/embedding/embedding.service';
import { RetrievalService } from '../../src/modules/retrieval/retrieval.service';
import { RerankerService } from '../../src/modules/reranking/reranker.service';
import { PromptBuilderService } from '../../src/modules/prompt/prompt-builder.service';

const NOW = '2024-01-01T00:00:00.000Z';

function makeSession(id = 'session-id') {
  return { id, messages: [], createdAt: NOW, updatedAt: NOW };
}

function makeRetrievalResult() {
  return {
    chunks: [],
    topScore: null,
    lowestScore: null,
    lowConfidence: true,
    durationMs: 10,
    queryDimensions: 3072,
  };
}

function makeRerankResult() {
  return {
    chunks: [],
    used: false,
    model: null,
    durationMs: 0,
    fallbackReason: 'low_confidence' as const,
  };
}

function makePromptResult() {
  return {
    messages: [],
    totalTokens: 100,
    systemTokens: 50,
    historyTokens: 0,
    contextTokens: 0,
    userTokens: 50,
    lowConfidenceMode: true,
    sourcesIncluded: [],
  };
}

describe('QueryService', () => {
  let service: QueryService;
  let mockSessionService: Record<string, ReturnType<typeof vi.fn>>;
  let mockRewriter: Record<string, ReturnType<typeof vi.fn>>;
  let mockEmbedding: Record<string, ReturnType<typeof vi.fn>>;
  let mockRetrieval: Record<string, ReturnType<typeof vi.fn>>;
  let mockReranker: Record<string, ReturnType<typeof vi.fn>>;
  let mockPromptBuilder: Record<string, ReturnType<typeof vi.fn>>;

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

    mockEmbedding = {
      embed: vi.fn().mockResolvedValue({
        vector: [0.1, 0.2],
        model: 'text-embedding-3-large',
        dimensions: 3072,
        cached: false,
        durationMs: 50,
      }),
    };

    mockRetrieval = {
      search: vi.fn().mockResolvedValue(makeRetrievalResult()),
    };

    mockReranker = {
      rerank: vi.fn().mockResolvedValue(makeRerankResult()),
    };

    mockPromptBuilder = {
      build: vi.fn().mockReturnValue(makePromptResult()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryService,
        {
          provide: PinoLogger,
          useValue: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn(), setContext: vi.fn() },
        },
        {
          provide: SessionService,
          useValue: mockSessionService,
        },
        {
          provide: QueryRewriterService,
          useValue: mockRewriter,
        },
        {
          provide: EmbeddingService,
          useValue: mockEmbedding,
        },
        {
          provide: RetrievalService,
          useValue: mockRetrieval,
        },
        {
          provide: RerankerService,
          useValue: mockReranker,
        },
        {
          provide: PromptBuilderService,
          useValue: mockPromptBuilder,
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'RERANK_TOP_N') return 5;
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get<QueryService>(QueryService);
  });

  it('returns requestId, conversationId, originalQuestion, rewrittenQuestion, rewriteUsed, fallbackReason, and history', async () => {
    const dto: QueryRequestDto = { question: 'What stack does Omar use?' };
    const result = await service.process(dto, 'test-request-id');

    expect(result.requestId).toBe('test-request-id');
    expect(result.conversationId).toBe('session-id');
    expect(result.originalQuestion).toBe('What stack does Omar use?');
    expect(result.rewrittenQuestion).toBe('What stack does Omar use?');
    expect(result.rewriteUsed).toBe(false);
    expect(result.fallbackReason).toBeNull();
    expect(result.history).toEqual([]);
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
