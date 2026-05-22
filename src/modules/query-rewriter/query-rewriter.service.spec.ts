import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getLoggerToken } from 'nestjs-pino';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { QueryRewriterService } from './query-rewriter.service';
import { OPENAI_CLIENT } from '../../shared/openai/openai.constants';
import type { Message } from '../../shared/session/session.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(role: Message['role'], content: string): Message {
  return { role, content, timestamp: new Date().toISOString() };
}

function makeOpenAIResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let service: QueryRewriterService;
let mockCreate: Mock;

beforeEach(async () => {
  mockCreate = vi.fn();

  const module = await Test.createTestingModule({
    providers: [
      QueryRewriterService,
      {
        provide: OPENAI_CLIENT,
        useValue: { chat: { completions: { create: mockCreate } } },
      },
      {
        provide: ConfigService,
        useValue: { get: () => 'gpt-4o-mini' },
      },
      {
        provide: getLoggerToken(QueryRewriterService.name),
        useValue: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      },
    ],
  }).compile();

  service = module.get(QueryRewriterService);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('QueryRewriterService', () => {
  it('returns rewritten question with rewriteUsed:true when model changes the text', async () => {
    const history = [
      makeMessage('user', 'Tell me about Omar.'),
      makeMessage('assistant', 'Omar loves pizza.'),
    ];
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse("What is Omar's favorite pizza topping?"));

    const result = await service.rewrite({
      originalQuestion: "What's his favorite topping?",
      history,
      requestId: 'req-1',
    });

    expect(result.rewrittenQuestion).toBe("What is Omar's favorite pizza topping?");
    expect(result.rewriteUsed).toBe(true);
    expect(result.fallbackReason).toBeNull();
  });

  it('returns rewriteUsed:false when model output matches original (case-insensitive)', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse('What is recursion?'));

    const result = await service.rewrite({
      originalQuestion: 'What is recursion?',
      history: [makeMessage('user', 'Tell me about async Python.')],
      requestId: 'req-2',
    });

    expect(result.rewrittenQuestion).toBe('What is recursion?');
    expect(result.rewriteUsed).toBe(false);
    expect(result.fallbackReason).toBeNull();
  });

  it('still calls the API when history is empty', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse('Who is Omar?'));

    await service.rewrite({
      originalQuestion: 'Who is Omar?',
      history: [],
      requestId: 'req-3',
    });

    expect(mockCreate).toHaveBeenCalledOnce();

    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage: string = callArgs.messages[1].content;
    expect(userMessage).toContain('History: (none)');
  });

  it('falls back with api_error when the API throws a non-abort error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('network failure'));

    const result = await service.rewrite({
      originalQuestion: 'Who is Omar?',
      history: [],
      requestId: 'req-4',
    });

    expect(result.rewrittenQuestion).toBe('Who is Omar?');
    expect(result.rewriteUsed).toBe(false);
    expect(result.fallbackReason).toBe('api_error');
  });

  it('falls back with timeout when the AbortController fires', async () => {
    const abortError = new DOMException('signal aborted', 'AbortError');
    mockCreate.mockRejectedValueOnce(abortError);

    const result = await service.rewrite({
      originalQuestion: 'Who is Omar?',
      history: [],
      requestId: 'req-5',
    });

    expect(result.rewrittenQuestion).toBe('Who is Omar?');
    expect(result.rewriteUsed).toBe(false);
    expect(result.fallbackReason).toBe('timeout');
  });

  it('falls back with invalid_output when the model returns an empty string', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(''));

    const result = await service.rewrite({
      originalQuestion: 'Who is Omar?',
      history: [],
      requestId: 'req-6',
    });

    expect(result.rewrittenQuestion).toBe('Who is Omar?');
    expect(result.rewriteUsed).toBe(false);
    expect(result.fallbackReason).toBe('invalid_output');
  });

  it('falls back with invalid_output when the model starts with a preamble like "Sure, here\'s"', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse("Sure, here's the rewrite: What is Omar's hobby?"),
    );

    const result = await service.rewrite({
      originalQuestion: "What's his hobby?",
      history: [makeMessage('user', 'Tell me about Omar.')],
      requestId: 'req-7',
    });

    expect(result.rewrittenQuestion).toBe("What's his hobby?");
    expect(result.rewriteUsed).toBe(false);
    expect(result.fallbackReason).toBe('invalid_output');
  });

  it('falls back with invalid_output when the output exceeds 500 characters', async () => {
    const longOutput = 'A'.repeat(501);
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(longOutput));

    const result = await service.rewrite({
      originalQuestion: 'Who is Omar?',
      history: [],
      requestId: 'req-8',
    });

    expect(result.rewrittenQuestion).toBe('Who is Omar?');
    expect(result.rewriteUsed).toBe(false);
    expect(result.fallbackReason).toBe('invalid_output');
  });
});
