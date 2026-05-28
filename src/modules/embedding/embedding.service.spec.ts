import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getLoggerToken } from 'nestjs-pino';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { EmbeddingService } from './embedding.service';
import { OPENAI_CLIENT } from '../../shared/openai/openai.constants';

const MODEL = 'text-embedding-3-large';
const DIMS = 3072;

function makeVector(dims = DIMS): number[] {
  return Array.from({ length: dims }, (_, i) => i * 0.0001);
}

function makeOpenAIResponse(vector: number[]) {
  return { data: [{ embedding: vector }] };
}

function makeStatusError(status: number): Error {
  const err = new Error(`OpenAI error ${status}`);
  (err as unknown as { status: number }).status = status;
  return err;
}

let service: EmbeddingService;
let mockEmbeddingsCreate: Mock;
let mockLogger: Record<string, Mock>;

beforeEach(async () => {
  mockEmbeddingsCreate = vi.fn();
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

  describe('successful embedding', () => {
    it('calls OpenAI and returns the vector', async () => {
      const vector = makeVector();
      mockEmbeddingsCreate.mockResolvedValue(makeOpenAIResponse(vector));

      const result = await service.embed({ text: 'Who is Omar?', requestId: 'r2' });

      expect(result.vector).toEqual(vector);
      expect(result.model).toBe(MODEL);
      expect(result.dimensions).toBe(DIMS);
      expect(mockEmbeddingsCreate).toHaveBeenCalledOnce();
    });
  });

  describe('retry logic', () => {
    it('retries on 5xx and throws ServiceUnavailableException after exhausting retries', async () => {
      mockEmbeddingsCreate.mockRejectedValue(makeStatusError(500));

      await expect(service.embed({ text: 'Who is Omar?', requestId: 'r5' })).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(3);
    }, 15_000);

    it('retries on 429 and throws ServiceUnavailableException after exhausting retries', async () => {
      mockEmbeddingsCreate.mockRejectedValue(makeStatusError(429));

      await expect(service.embed({ text: 'Who is Omar?', requestId: 'r6' })).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(3);
    }, 15_000);

    it('does NOT retry on 401 — throws immediately', async () => {
      mockEmbeddingsCreate.mockRejectedValue(makeStatusError(401));

      await expect(service.embed({ text: 'Who is Omar?', requestId: 'r7' })).rejects.toThrow();
      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('response validation', () => {
    it('throws ServiceUnavailableException when OpenAI returns a vector with wrong dimension count', async () => {
      mockEmbeddingsCreate.mockResolvedValue(makeOpenAIResponse(makeVector(10)));

      await expect(service.embed({ text: 'Who is Omar?', requestId: 'r8' })).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
