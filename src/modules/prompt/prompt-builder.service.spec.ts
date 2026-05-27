import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { PromptBuilderService } from './prompt-builder.service';
import type { RerankedChunk } from '../reranking/reranker.types';
import type { Message } from '../../shared/session/session.types';
import { SYSTEM_MESSAGE, LOW_CONFIDENCE_SYSTEM_MESSAGE } from './system-messages';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeChunk(overrides: Partial<RerankedChunk> = {}): RerankedChunk {
  return {
    id: overrides.id ?? 'c1',
    score: overrides.score ?? 0.8,
    text: overrides.text ?? 'Chunk text content',
    sourceFile: overrides.sourceFile ?? 'cv.md',
    sourceType: overrides.sourceType ?? 'markdown',
    chunkIndex: overrides.chunkIndex ?? 0,
    totalChunks: overrides.totalChunks ?? 10,
    rerankerScore: overrides.rerankerScore ?? 0.9,
    vectorScore: overrides.vectorScore ?? 0.8,
    headingPath: overrides.headingPath,
    pageNumber: overrides.pageNumber,
  };
}

function makeChunks(count: number): RerankedChunk[] {
  return Array.from({ length: count }, (_, i) =>
    makeChunk({
      id: `c${i}`,
      sourceFile: `doc${i}.md`,
      text: `Text for chunk ${i}`,
      headingPath: [`Section ${i}`],
    }),
  );
}

function makeHistory(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `Message ${i}`,
    timestamp: new Date().toISOString(),
  }));
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let service: PromptBuilderService;
let mockLogger: Record<string, Mock>;

beforeEach(async () => {
  mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    setContext: vi.fn(),
  };

  const module = await Test.createTestingModule({
    providers: [
      PromptBuilderService,
      {
        provide: PinoLogger,
        useValue: mockLogger,
      },
    ],
  }).compile();

  service = module.get(PromptBuilderService);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PromptBuilderService', () => {
  describe('message count', () => {
    it('builds 6 messages for 5 chunks + 4 history messages (1 system + 4 history + 1 user)', () => {
      const result = service.build({
        originalQuestion: 'What teaching experience does Omar have?',
        rerankedChunks: makeChunks(5),
        conversationHistory: makeHistory(4),
        lowConfidenceMode: false,
        requestId: 'r1',
      });

      expect(result.messages).toHaveLength(6);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[5].role).toBe('user');
    });

    it('builds 2 messages with empty history (1 system + 1 user)', () => {
      const result = service.build({
        originalQuestion: 'Test question',
        rerankedChunks: makeChunks(3),
        conversationHistory: [],
        lowConfidenceMode: false,
        requestId: 'r2',
      });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
    });
  });

  describe('low confidence mode', () => {
    it('uses LOW_CONFIDENCE_SYSTEM_MESSAGE and omits CONTEXT block', () => {
      const result = service.build({
        originalQuestion: 'What is the capital of Brazil?',
        rerankedChunks: [],
        conversationHistory: [],
        lowConfidenceMode: true,
        requestId: 'r3',
      });

      expect(result.messages[0].content).toBe(LOW_CONFIDENCE_SYSTEM_MESSAGE);
      expect(result.lowConfidenceMode).toBe(true);
      expect(result.sourcesIncluded).toEqual([]);

      const userMsg = result.messages[result.messages.length - 1];
      expect(userMsg.content).not.toContain('CONTEXT:');
      expect(userMsg.content).toContain('QUESTION:');
    });

    it('has contextTokens of 0 in low confidence mode', () => {
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: [],
        conversationHistory: [],
        lowConfidenceMode: true,
        requestId: 'r4',
      });

      expect(result.contextTokens).toBe(0);
    });
  });

  describe('normal confidence mode', () => {
    it('uses SYSTEM_MESSAGE and includes CONTEXT block', () => {
      const result = service.build({
        originalQuestion: 'What teaching experience?',
        rerankedChunks: makeChunks(3),
        conversationHistory: [],
        lowConfidenceMode: false,
        requestId: 'r5',
      });

      expect(result.messages[0].content).toBe(SYSTEM_MESSAGE);
      expect(result.lowConfidenceMode).toBe(false);

      const userMsg = result.messages[result.messages.length - 1];
      expect(userMsg.content).toContain('CONTEXT:');
      expect(userMsg.content).toContain('QUESTION:');
    });

    it('includes 1-based [Source N: ...] labels that match sourcesIncluded indices', () => {
      const chunks = makeChunks(3);
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: chunks,
        conversationHistory: [],
        lowConfidenceMode: false,
        requestId: 'r6',
      });

      const userContent = result.messages[result.messages.length - 1].content;

      for (let i = 0; i < 3; i++) {
        const label = `[Source ${i + 1}:`;
        expect(userContent).toContain(label);
        expect(result.sourcesIncluded[i].index).toBe(i + 1);
      }
    });
  });

  describe('source label edge cases', () => {
    it('omits heading path when headingPath is undefined', () => {
      const chunk = makeChunk({ sourceFile: 'cv.md', headingPath: undefined });
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: [chunk],
        conversationHistory: [],
        lowConfidenceMode: false,
        requestId: 'r7',
      });

      const userContent = result.messages[result.messages.length - 1].content;
      expect(userContent).toContain('[Source 1: cv.md]');
      expect(userContent).not.toContain('>');
    });

    it('omits heading path when headingPath is empty array', () => {
      const chunk = makeChunk({ sourceFile: 'cv.md', headingPath: [] });
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: [chunk],
        conversationHistory: [],
        lowConfidenceMode: false,
        requestId: 'r8',
      });

      const userContent = result.messages[result.messages.length - 1].content;
      expect(userContent).toContain('[Source 1: cv.md]');
      expect(userContent).not.toContain('>');
    });

    it('includes page number in label when pageNumber is set', () => {
      const chunk = makeChunk({ sourceFile: 'thesis.pdf', pageNumber: 42 });
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: [chunk],
        conversationHistory: [],
        lowConfidenceMode: false,
        requestId: 'r9',
      });

      const userContent = result.messages[result.messages.length - 1].content;
      expect(userContent).toContain(', page 42');
      expect(result.sourcesIncluded[0].pageNumber).toBe(42);
    });

    it('omits page number when pageNumber is undefined', () => {
      const chunk = makeChunk({ pageNumber: undefined });
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: [chunk],
        conversationHistory: [],
        lowConfidenceMode: false,
        requestId: 'r10',
      });

      const userContent = result.messages[result.messages.length - 1].content;
      expect(userContent).not.toContain(', page');
    });
  });

  describe('defensive guard: empty chunks with lowConfidenceMode false', () => {
    it('forces lowConfidenceMode to true and logs a warning', () => {
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: [],
        conversationHistory: [],
        lowConfidenceMode: false,
        requestId: 'r11',
      });

      expect(result.lowConfidenceMode).toBe(true);
      expect(result.sourcesIncluded).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'r11' }),
        'prompt_low_confidence_forced',
      );
    });
  });

  describe('token counts', () => {
    it('returns positive integers for all token fields', () => {
      const result = service.build({
        originalQuestion: "What is Omar's teaching experience?",
        rerankedChunks: makeChunks(5),
        conversationHistory: makeHistory(2),
        lowConfidenceMode: false,
        requestId: 'r12',
      });

      expect(result.systemTokens).toBeGreaterThan(0);
      expect(result.historyTokens).toBeGreaterThan(0);
      expect(result.contextTokens).toBeGreaterThan(0);
      expect(result.userTokens).toBeGreaterThan(0);
      expect(result.totalTokens).toBeGreaterThan(0);
    });

    it('totalTokens equals systemTokens + historyTokens + userTokens', () => {
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: makeChunks(3),
        conversationHistory: makeHistory(2),
        lowConfidenceMode: false,
        requestId: 'r13',
      });

      expect(result.totalTokens).toBe(
        result.systemTokens + result.historyTokens + result.userTokens,
      );
    });

    it('historyTokens is 0 when conversationHistory is empty', () => {
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: makeChunks(2),
        conversationHistory: [],
        lowConfidenceMode: false,
        requestId: 'r14',
      });

      expect(result.historyTokens).toBe(0);
    });
  });

  describe('sourcesIncluded', () => {
    it('is empty in low confidence mode', () => {
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: makeChunks(3),
        conversationHistory: [],
        lowConfidenceMode: true,
        requestId: 'r15',
      });

      expect(result.sourcesIncluded).toEqual([]);
    });

    it('has one entry per reranked chunk with matching 1-based index', () => {
      const chunks = makeChunks(3);
      const result = service.build({
        originalQuestion: 'Q',
        rerankedChunks: chunks,
        conversationHistory: [],
        lowConfidenceMode: false,
        requestId: 'r16',
      });

      expect(result.sourcesIncluded).toHaveLength(3);
      expect(result.sourcesIncluded[0].index).toBe(1);
      expect(result.sourcesIncluded[1].index).toBe(2);
      expect(result.sourcesIncluded[2].index).toBe(3);
      expect(result.sourcesIncluded[0].sourceFile).toBe(chunks[0].sourceFile);
    });
  });
});
