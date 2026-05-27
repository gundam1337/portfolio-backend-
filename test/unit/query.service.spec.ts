import { Test, TestingModule } from '@nestjs/testing';
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
import { LlmService } from '../../src/modules/llm/llm.service';

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
    messages: [{ role: 'user' as const, content: 'test' }],
    totalTokens: 100,
    systemTokens: 50,
    historyTokens: 0,
    contextTokens: 0,
    userTokens: 50,
    lowConfidenceMode: true,
    sourcesIncluded: [],
  };
}

function makeLlmResult() {
  return {
    text: 'Omar uses Next.js, NestJS, and TypeScript.',
    model: 'gpt-4o-mini',
    promptTokens: 80,
    completionTokens: 20,
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
  let mockLlm: Record<string, ReturnType<typeof vi.fn>>;

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

    mockLlm = {
      complete: vi.fn().mockResolvedValue(makeLlmResult()),
      suggestFollowUps: vi.fn().mockResolvedValue(['Follow-up 1', 'Follow-up 2', 'Follow-up 3']),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryService,
        {
          provide: PinoLogger,
          useValue: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn(), setContext: vi.fn() },
        },
        { provide: SessionService, useValue: mockSessionService },
        { provide: QueryRewriterService, useValue: mockRewriter },
        { provide: EmbeddingService, useValue: mockEmbedding },
        { provide: RetrievalService, useValue: mockRetrieval },
        { provide: RerankerService, useValue: mockReranker },
        { provide: PromptBuilderService, useValue: mockPromptBuilder },
        { provide: LlmService, useValue: mockLlm },
      ],
    }).compile();

    service = module.get<QueryService>(QueryService);
  });

  it('returns requestId, conversationId, answer, confidence, sources, suggestions, and status', async () => {
    const dto: QueryRequestDto = { question: 'What stack does Omar use?' };
    const result = await service.process(dto, 'test-request-id');

    expect(result.requestId).toBe('test-request-id');
    expect(result.conversationId).toBe('session-id');
    expect(result.answer.text).toBe('Omar uses Next.js, NestJS, and TypeScript.');
    expect(result.answer.format).toBe('markdown');
    expect(result.confidence.level).toBe('low');
    expect(result.sources).toEqual([]);
    expect(result.suggestions).toEqual(['Follow-up 1', 'Follow-up 2', 'Follow-up 3']);
    expect(result.status).toBe('low_confidence');
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

    expect(mockSessionService.appendUserMessage).toHaveBeenCalledWith('session-id', 'Hello');
  });

  it('appends the assistant message after LLM response', async () => {
    const dto: QueryRequestDto = { question: 'Hello' };
    await service.process(dto, 'req-id');

    expect(mockSessionService.appendAssistantMessage).toHaveBeenCalledWith(
      'session-id',
      'Omar uses Next.js, NestJS, and TypeScript.',
    );
  });

  it('returns status answered when retrieval has results', async () => {
    const chunk = {
      id: '1',
      score: 0.8,
      rerankerScore: 0.85,
      vectorScore: 0.8,
      text: 'Omar uses Next.js and NestJS.',
      sourceFile: 'cv.md',
      sourceType: 'markdown' as const,
      chunkIndex: 0,
      totalChunks: 1,
      headingPath: ['Skills'],
    };
    mockRetrieval.search.mockResolvedValue({ ...makeRetrievalResult(), chunks: [chunk], topScore: 0.8, lowConfidence: false });
    mockReranker.rerank.mockResolvedValue({ chunks: [chunk], used: true, model: 'rerank-v3.5', durationMs: 10, fallbackReason: null });

    const result = await service.process({ question: 'Skills?' }, 'req-id');

    expect(result.status).toBe('answered');
    expect(result.confidence.level).toBe('high');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].id).toBe('source_1');
    expect(result.sources[0].title).toBe('cv.md');
    expect(result.sources[0].section).toBe('Skills');
  });
});
