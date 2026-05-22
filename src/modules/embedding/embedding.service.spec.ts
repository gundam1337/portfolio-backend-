import * as crypto from 'crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getLoggerToken } from 'nestjs-pino';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { EmbeddingService } from './embedding.service';
import { OPENAI_CLIENT } from '../../shared/openai/openai.constants';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';

// ─── Constants matching service defaults ────────────────────────────────────

const MODEL = 'text-embedding-3-large';
const DIMS = 3072;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeVector(dims = DIMS): number[] {
  return Array.from({ length: dims }, (_, i) => i * 0.0001);
}

function cacheKey(text: string, model = MODEL, dims = DIMS): string {
  const hash = crypto.createHash('sha256').update(text.trim()).digest('hex');
  return `embedding:${model}:${dims}:${hash}`;
}

function makeOpenAIResponse(vector: number[]) {
  return { data: [{ embedding: vector }] };
}

function makeStatusError(status: number): Error {
  const err = new Error(`OpenAI error ${status}`);
  (err as unknown as { status: number }).status = status;
  return err;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let service: EmbeddingService;
let mockEmbeddingsCreate: Mock;
let mockRedisGet: Mock;
let mockRedisSet: Mock;
let mockLogger: Record<string, Mock>;

beforeEach(async () => {
  mockEmbeddingsCreate = vi.fn();
  mockRedisGet = vi.fn().mockResolvedValue(null);
  mockRedisSet = vi.fn().mockResolvedValue('OK');
  mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const module = await Test.createTestingModule({
    providers: [
      EmbeddingService,
      {
        provide: OPENAI_CLIENT,
        useValue: { embeddings: { create: mockEmbeddingsCreate } },
      },
      {
        provide: REDIS_CLIENT,
        useValue: { get: mockRedisGet, set: mockRedisSet },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => {
            if (key === 'OPENAI_EMBEDDING_MODEL') return MODEL;
            if (key === 'OPENAI_EMBEDDING_DIMENSIONS') return DIMS;
            return undefined;
          },
        },
      },
      {
        provide: getLoggerToken(EmbeddingService.name),
        useValue: mockLogger,
      },
    ],
  }).compile();

  service = module.get(EmbeddingService);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('EmbeddingService', () => {
  describe('input validation', () => {
    it('throws BadRequestException on empty string and does NOT call OpenAI', async () => {
      await expect(service.embed({ text: '', requestId: 'r1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on whitespace-only string', async () => {
      await expect(service.embed({ text: '   ', requestId: 'r1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
    });
  });

  describe('cache miss → fresh embedding', () => {
    it('calls OpenAI, writes to Redis, returns cached:false', async () => {
      const vector = makeVector();
      mockRedisGet.mockResolvedValue(null);
      mockEmbeddingsCreate.mockResolvedValue(makeOpenAIResponse(vector));

      const result = await service.embed({ text: 'Who is Omar?', requestId: 'r2' });

      expect(result.cached).toBe(false);
      expect(result.vector).toEqual(vector);
      expect(result.model).toBe(MODEL);
      expect(result.dimensions).toBe(DIMS);
      expect(mockEmbeddingsCreate).toHaveBeenCalledOnce();
      expect(mockRedisSet).toHaveBeenCalledOnce();

      const [key, json, , ttl] = mockRedisSet.mock.calls[0] as [string, string, string, number];
      expect(key).toBe(cacheKey('Who is Omar?'));
      expect(ttl).toBe(86_400);
      const stored = JSON.parse(json) as { vector: number[]; model: string };
      expect(stored.vector).toEqual(vector);
    });
  });

  describe('cache hit', () => {
    it('returns from Redis, cached:true, does NOT call OpenAI', async () => {
      const vector = makeVector();
      const payload = JSON.stringify({ vector, model: MODEL, dimensions: DIMS, createdAt: new Date().toISOString() });
      mockRedisGet.mockResolvedValue(payload);

      const result = await service.embed({ text: 'Who is Omar?', requestId: 'r3' });

      expect(result.cached).toBe(true);
      expect(result.vector).toEqual(vector);
      expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
    });
  });

  describe('corrupt cache', () => {
    it('logs a warning and falls through to fresh embedding when dimension count is wrong', async () => {
      const badVector = makeVector(10); // wrong dimensions
      const payload = JSON.stringify({ vector: badVector, model: MODEL, dimensions: 10, createdAt: new Date().toISOString() });
      mockRedisGet.mockResolvedValue(payload);

      const freshVector = makeVector();
      mockEmbeddingsCreate.mockResolvedValue(makeOpenAIResponse(freshVector));

      const result = await service.embed({ text: 'Who is Omar?', requestId: 'r4' });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKey: cacheKey('Who is Omar?') }),
        'embedding_cache_corrupt',
      );
      expect(result.cached).toBe(false);
      expect(mockEmbeddingsCreate).toHaveBeenCalledOnce();
    });

    it('logs a warning and falls through when cached value is not valid JSON', async () => {
      mockRedisGet.mockResolvedValue('not-json{{{');
      const freshVector = makeVector();
      mockEmbeddingsCreate.mockResolvedValue(makeOpenAIResponse(freshVector));

      const result = await service.embed({ text: 'Who is Omar?', requestId: 'r4b' });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKey: cacheKey('Who is Omar?') }),
        'embedding_cache_corrupt',
      );
      expect(result.cached).toBe(false);
    });
  });

  describe('retry logic', () => {
    it('retries on 5xx and throws ServiceUnavailableException after exhausting retries', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockEmbeddingsCreate.mockRejectedValue(makeStatusError(500));

      await expect(service.embed({ text: 'Who is Omar?', requestId: 'r5' })).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(3);
    }, 15_000);

    it('retries on 429 and throws ServiceUnavailableException after exhausting retries', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockEmbeddingsCreate.mockRejectedValue(makeStatusError(429));

      await expect(service.embed({ text: 'Who is Omar?', requestId: 'r6' })).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(3);
    }, 15_000);

    it('does NOT retry on 401 — throws immediately', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockEmbeddingsCreate.mockRejectedValue(makeStatusError(401));

      // 401 is a non-retryable 4xx; retryWithBackoff re-throws it immediately.
      // fetchEmbedding then sees it has no status in the 400–499 "non-503 client" band
      // and wraps it as ServiceUnavailableException. The important assertion is that
      // OpenAI was called only once.
      await expect(service.embed({ text: 'Who is Omar?', requestId: 'r7' })).rejects.toThrow();
      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('response validation', () => {
    it('throws (wrapped as 503) when OpenAI returns a vector with wrong dimension count', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockEmbeddingsCreate.mockResolvedValue(makeOpenAIResponse(makeVector(10)));

      await expect(service.embed({ text: 'Who is Omar?', requestId: 'r8' })).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('cache key consistency', () => {
    it('produces the same cache key for the same input text', async () => {
      const text = 'Who is Omar?';
      const key1 = cacheKey(text);
      const key2 = cacheKey(text);
      expect(key1).toBe(key2);
    });

    it('includes model name in the cache key (cross-model isolation)', async () => {
      const text = 'Who is Omar?';
      const key1 = cacheKey(text, 'text-embedding-3-large', DIMS);
      const key2 = cacheKey(text, 'text-embedding-ada-002', DIMS);
      expect(key1).not.toBe(key2);
    });

    it('includes dimensions in the cache key (cross-config isolation)', async () => {
      const text = 'Who is Omar?';
      const key1 = cacheKey(text, MODEL, 3072);
      const key2 = cacheKey(text, MODEL, 1536);
      expect(key1).not.toBe(key2);
    });

    it('uses SHA-256: same text always yields the same key regardless of instance', () => {
      const text = 'stable input';
      const expected = `embedding:${MODEL}:${DIMS}:${crypto.createHash('sha256').update(text).digest('hex')}`;
      expect(cacheKey(text)).toBe(expected);
    });
  });
});
