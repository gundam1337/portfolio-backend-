import {
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { RetrievalService } from './retrieval.service';
import { QDRANT_CLIENT } from './qdrant.client.provider';

// ─── Constants ──────────────────────────────────────────────────────────────

const DIMS = 3072;
const COLLECTION = 'personal_docs';
const TOP_K = 15;
const SCORE_FLOOR = 0.3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeVector(dims = DIMS): number[] {
  return Array.from({ length: dims }, (_, i) => i * 0.0001);
}

function makeStatusError(status: number): Error {
  const err = new Error(`Qdrant error ${status}`);
  (err as unknown as { status: number }).status = status;
  return err;
}

function makeScoredPoint(
  id: string,
  score: number,
  payloadOverrides: Record<string, unknown> = {},
) {
  return {
    id,
    version: 1,
    score,
    payload: {
      text: `Chunk text for ${id}`,
      sourceFile: 'cv.md',
      sourceType: 'markdown',
      chunkIndex: 0,
      totalChunks: 10,
      headingPath: ['Omar Derkaoui', 'Experience'],
      indexedAt: new Date().toISOString(),
      sourceHash: 'abc123',
      ...payloadOverrides,
    },
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let service: RetrievalService;
let mockQdrantSearch: Mock;
let mockLogger: Record<string, Mock>;

beforeEach(async () => {
  mockQdrantSearch = vi.fn();
  mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    setContext: vi.fn(),
  };

  const module = await Test.createTestingModule({
    providers: [
      RetrievalService,
      {
        provide: QDRANT_CLIENT,
        useValue: { search: mockQdrantSearch },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => {
            const map: Record<string, unknown> = {
              QDRANT_COLLECTION: COLLECTION,
              RETRIEVAL_TOP_K: TOP_K,
              RETRIEVAL_SCORE_FLOOR: SCORE_FLOOR,
              OPENAI_EMBEDDING_DIMENSIONS: DIMS,
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

  service = module.get(RetrievalService);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RetrievalService', () => {
  describe('vector validation', () => {
    it('throws InternalServerErrorException for wrong dimensions without calling Qdrant', async () => {
      const badVector = makeVector(10);

      await expect(
        service.search({ queryVector: badVector, requestId: 'r1' }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockQdrantSearch).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException for empty vector without calling Qdrant', async () => {
      await expect(
        service.search({ queryVector: [], requestId: 'r2' }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockQdrantSearch).not.toHaveBeenCalled();
    });
  });

  describe('successful search', () => {
    it('calls Qdrant once and returns mapped chunks in score order', async () => {
      const points = [
        makeScoredPoint('p1', 0.85),
        makeScoredPoint('p2', 0.72),
        makeScoredPoint('p3', 0.61),
      ];
      mockQdrantSearch.mockResolvedValue(points);

      const result = await service.search({ queryVector: makeVector(), requestId: 'r3' });

      expect(mockQdrantSearch).toHaveBeenCalledOnce();
      expect(result.chunks).toHaveLength(3);
      expect(result.chunks[0].score).toBe(0.85);
      expect(result.chunks[1].score).toBe(0.72);
      expect(result.chunks[2].score).toBe(0.61);
      expect(result.chunks[0].id).toBe('p1');
    });

    it('passes filter: undefined to Qdrant (Step 6 placeholder)', async () => {
      mockQdrantSearch.mockResolvedValue([makeScoredPoint('p1', 0.8)]);

      await service.search({ queryVector: makeVector(), requestId: 'r4' });

      const callArgs = mockQdrantSearch.mock.calls[0] as [string, { filter: unknown }];
      expect(callArgs[1].filter).toBeUndefined();
    });

    it('sets queryDimensions equal to the query vector length', async () => {
      mockQdrantSearch.mockResolvedValue([]);

      const result = await service.search({ queryVector: makeVector(), requestId: 'r5' });

      expect(result.queryDimensions).toBe(DIMS);
    });
  });

  describe('empty results', () => {
    it('returns chunks:[], topScore:null, lowConfidence:true when Qdrant returns nothing', async () => {
      mockQdrantSearch.mockResolvedValue([]);

      const result = await service.search({ queryVector: makeVector(), requestId: 'r6' });

      expect(result.chunks).toEqual([]);
      expect(result.topScore).toBeNull();
      expect(result.lowestScore).toBeNull();
      expect(result.lowConfidence).toBe(true);
    });
  });

  describe('confidence scoring', () => {
    it('sets lowConfidence:true when topScore is below the floor', async () => {
      mockQdrantSearch.mockResolvedValue([makeScoredPoint('p1', 0.25)]);

      const result = await service.search({ queryVector: makeVector(), requestId: 'r7' });

      expect(result.topScore).toBe(0.25);
      expect(result.lowConfidence).toBe(true);
      expect(result.chunks).toHaveLength(1);
    });

    it('sets lowConfidence:false when topScore is above the floor', async () => {
      mockQdrantSearch.mockResolvedValue([makeScoredPoint('p1', 0.85)]);

      const result = await service.search({ queryVector: makeVector(), requestId: 'r8' });

      expect(result.topScore).toBe(0.85);
      expect(result.lowConfidence).toBe(false);
    });
  });

  describe('payload validation', () => {
    it('skips a point with missing text field, logs a warning, returns other points', async () => {
      const goodPoint = makeScoredPoint('good', 0.8);
      const badPoint = makeScoredPoint('bad', 0.75, { text: undefined });
      mockQdrantSearch.mockResolvedValue([goodPoint, badPoint]);

      const result = await service.search({ queryVector: makeVector(), requestId: 'r9' });

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].id).toBe('good');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ pointId: 'bad' }),
        'retrieval_point_skipped',
      );
    });
  });

  describe('error handling', () => {
    it('retries on 5xx up to 3 times then throws ServiceUnavailableException', async () => {
      mockQdrantSearch.mockRejectedValue(makeStatusError(503));

      await expect(
        service.search({ queryVector: makeVector(), requestId: 'r10' }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mockQdrantSearch).toHaveBeenCalledTimes(3);
    }, 15_000);

    it('retries on 429 then throws ServiceUnavailableException', async () => {
      mockQdrantSearch.mockRejectedValue(makeStatusError(429));

      await expect(
        service.search({ queryVector: makeVector(), requestId: 'r11' }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mockQdrantSearch).toHaveBeenCalledTimes(3);
    }, 15_000);

    it('does NOT retry on 401 — throws InternalServerErrorException immediately', async () => {
      mockQdrantSearch.mockRejectedValue(makeStatusError(401));

      await expect(
        service.search({ queryVector: makeVector(), requestId: 'r12' }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockQdrantSearch).toHaveBeenCalledTimes(1);
    });
  });
});
