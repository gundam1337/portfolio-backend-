import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { RerankerService } from './reranker.service';
import { COHERE_CLIENT } from '../../shared/cohere/cohere.constants';
import type { RetrievedChunk } from '../retrieval/retrieval.types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: overrides.id ?? 'c1',
    score: overrides.score ?? 0.8,
    text: overrides.text ?? 'Some chunk text',
    sourceFile: overrides.sourceFile ?? 'cv.md',
    sourceType: overrides.sourceType ?? 'markdown',
    chunkIndex: overrides.chunkIndex ?? 0,
    totalChunks: overrides.totalChunks ?? 10,
    headingPath: overrides.headingPath,
    pageNumber: overrides.pageNumber,
  };
}

function makeChunks(count: number): RetrievedChunk[] {
  return Array.from({ length: count }, (_, i) =>
    makeChunk({ id: `c${i}`, score: (count - i) * 0.1, text: `Chunk text ${i}` }),
  );
}

function makeStatusError(status: number): Error {
  const err = new Error(`Cohere error ${status}`);
  (err as unknown as { status: number }).status = status;
  return err;
}

function makeAbortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const MODEL = 'rerank-v3.5';
const TOP_N = 5;

let service: RerankerService;
let mockV2Rerank: Mock;
let mockLogger: Record<string, Mock>;

beforeEach(async () => {
  mockV2Rerank = vi.fn();
  mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    setContext: vi.fn(),
  };

  const module = await Test.createTestingModule({
    providers: [
      RerankerService,
      {
        provide: COHERE_CLIENT,
        useValue: { rerank: mockV2Rerank },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => {
            const map: Record<string, unknown> = {
              COHERE_RERANK_MODEL: MODEL,
              RERANK_TOP_N: TOP_N,
            };
            return map[key];
          },
        },
      },
      {
        provide: PinoLogger,
        useValue: mockLogger,
      },
    ],
  }).compile();

  service = module.get(RerankerService);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RerankerService', () => {
  describe('successful rerank', () => {
    it('returns up to topN chunks ordered by rerankerScore descending', async () => {
      const chunks = makeChunks(15);
      // Cohere returns 5 results reordered: original indices 3,0,7,1,5
      mockV2Rerank.mockResolvedValue({
        results: [
          { index: 3, relevanceScore: 0.95 },
          { index: 0, relevanceScore: 0.88 },
          { index: 7, relevanceScore: 0.75 },
          { index: 1, relevanceScore: 0.62 },
          { index: 5, relevanceScore: 0.44 },
        ],
      });

      const result = await service.rerank({
        query: 'teaching experience',
        chunks,
        requestId: 'r3',
      });

      expect(result.used).toBe(true);
      expect(result.model).toBe(MODEL);
      expect(result.fallbackReason).toBeNull();
      expect(result.chunks).toHaveLength(5);

      // Ordered by rerankerScore descending
      expect(result.chunks[0].rerankerScore).toBe(0.95);
      expect(result.chunks[0].id).toBe(chunks[3].id);
      expect(result.chunks[1].rerankerScore).toBe(0.88);
      expect(result.chunks[1].id).toBe(chunks[0].id);
      expect(result.chunks[4].rerankerScore).toBe(0.44);
    });

    it('preserves vectorScore from the original chunk score', async () => {
      const chunks = makeChunks(3);
      mockV2Rerank.mockResolvedValue({
        results: [
          { index: 2, relevanceScore: 0.9 },
          { index: 0, relevanceScore: 0.7 },
          { index: 1, relevanceScore: 0.5 },
        ],
      });

      const result = await service.rerank({
        query: 'test',
        chunks,
        requestId: 'r4',
      });

      // vectorScore must come from the original chunk's score field
      expect(result.chunks[0].vectorScore).toBe(chunks[2].score);
      expect(result.chunks[1].vectorScore).toBe(chunks[0].score);
      expect(result.chunks[2].vectorScore).toBe(chunks[1].score);
    });

    it('passes raw text strings to Cohere (not embeddingInput)', async () => {
      const chunks = makeChunks(3);
      mockV2Rerank.mockResolvedValue({
        results: chunks.map((_, i) => ({ index: i, relevanceScore: 0.5 - i * 0.1 })),
      });

      await service.rerank({
        query: 'test',
        chunks,
        requestId: 'r5',
      });

      const callArgs = mockV2Rerank.mock.calls[0][0] as { documents: string[] };
      expect(callArgs.documents).toEqual(chunks.map((c) => c.text));
    });
  });

  describe('retry behaviour', () => {
    it('retries up to 3 times on 5xx then throws', async () => {
      mockV2Rerank.mockRejectedValue(makeStatusError(503));

      await expect(
        service.rerank({ query: 'test', chunks: makeChunks(10), requestId: 'r6' }),
      ).rejects.toThrow();

      expect(mockV2Rerank).toHaveBeenCalledTimes(3);
    }, 15_000);

    it('retries on 429 then throws', async () => {
      mockV2Rerank.mockRejectedValue(makeStatusError(429));

      await expect(
        service.rerank({ query: 'test', chunks: makeChunks(10), requestId: 'r7' }),
      ).rejects.toThrow();

      expect(mockV2Rerank).toHaveBeenCalledTimes(3);
    }, 15_000);

    it('does NOT retry on 401, throws immediately', async () => {
      mockV2Rerank.mockRejectedValue(makeStatusError(401));

      await expect(
        service.rerank({ query: 'test', chunks: makeChunks(10), requestId: 'r8' }),
      ).rejects.toThrow();

      expect(mockV2Rerank).toHaveBeenCalledTimes(1);
    });
  });

  describe('timeout', () => {
    it('throws on AbortError', async () => {
      mockV2Rerank.mockRejectedValue(makeAbortError());

      await expect(
        service.rerank({ query: 'test', chunks: makeChunks(10), requestId: 'r9' }),
      ).rejects.toThrow('Aborted');
    }, 15_000);
  });

  describe('invalid response shape', () => {
    it('throws when results is not an array', async () => {
      mockV2Rerank.mockResolvedValue({ results: null });

      await expect(
        service.rerank({ query: 'test', chunks: makeChunks(10), requestId: 'r10' }),
      ).rejects.toThrow('response.results is not an array');
    });

    it('throws when a result item is missing relevanceScore', async () => {
      mockV2Rerank.mockResolvedValue({
        results: [{ index: 0 }], // missing relevanceScore
      });

      await expect(
        service.rerank({ query: 'test', chunks: makeChunks(5), requestId: 'r11' }),
      ).rejects.toThrow('invalid shape');
    });
  });
});
