import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import OpenAI from 'openai';
import type { Env } from '../../config/env.validation';
import { OPENAI_CLIENT } from '../../shared/openai/openai.constants';
import type { Message } from '../../shared/session/session.types';
import type { FallbackReason, RewriteInput, RewriteResult } from './query-rewriter.types';

const REWRITE_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_CHARS = 500;

const INVALID_PREFIXES = ['sure', 'here', 'rewrite:', '"', "'", '`', '#'];

const SYSTEM_PROMPT = `You are a query rewriter for a retrieval system. Your only job is to rewrite the user's latest message into a standalone, self-contained question that can be understood without the prior conversation.

Rules:
- Output ONLY the rewritten question. No explanations, no quotes, no prefixes.
- If the message is already standalone, output it unchanged.
- If the message cannot be resolved from the conversation history, output it unchanged.
- Preserve proper nouns, entities, and specific terms from the history.
- Do not add information that isn't in the history or the message.

Examples:
History: User asked about Omar. Assistant said Omar loves pizza.
Message: "what's his favorite topping?"
Rewrite: What is Omar's favorite pizza topping?

History: User asked about the Eiffel Tower.
Message: "how tall is it?"
Rewrite: How tall is the Eiffel Tower?

History: User asked about Python's async features.
Message: "what is recursion?"
Rewrite: What is recursion?`;

function buildUserMessage(originalQuestion: string, history: Message[]): string {
  const historyBlock =
    history.length === 0
      ? 'History: (none)'
      : 'History:\n' +
        history.map((m) => `[${m.role}]: ${m.content}`).join('\n');

  return `${historyBlock}\n\nMessage: ${originalQuestion}\nRewrite:`;
}

function validateOutput(raw: string): { valid: true; text: string } | { valid: false } {
  const trimmed = raw.trim();

  if (!trimmed) return { valid: false };
  if (trimmed.length > MAX_OUTPUT_CHARS) return { valid: false };

  const lower = trimmed.toLowerCase();
  for (const prefix of INVALID_PREFIXES) {
    if (lower.startsWith(prefix)) return { valid: false };
  }

  return { valid: true, text: trimmed };
}

@Injectable()
export class QueryRewriterService {
  private readonly model: string;

  constructor(
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAI,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(QueryRewriterService.name);
    this.model = config.get('OPENAI_REWRITER_MODEL', { infer: true });
  }

  async rewrite(input: RewriteInput): Promise<RewriteResult> {
    const { originalQuestion, history, requestId } = input;
    const startMs = Date.now();

    this.logger.debug(
      { requestId, historyLength: history.length, originalLength: originalQuestion.length },
      'query_rewrite_started',
    );

    const fallback = (reason: FallbackReason): RewriteResult => {
      this.logger.warn(
        { requestId, fallbackReason: reason, durationMs: Date.now() - startMs },
        'query_rewrite_fallback',
      );
      return { rewrittenQuestion: originalQuestion, rewriteUsed: false, fallbackReason: reason };
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REWRITE_TIMEOUT_MS);

    try {
      const response = await this.openai.chat.completions.create(
        {
          model: this.model,
          temperature: 0,
          max_tokens: 150,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserMessage(originalQuestion, history) },
          ],
        },
        { signal: controller.signal },
      );

      clearTimeout(timer);

      const raw = response.choices[0]?.message?.content ?? '';
      const validation = validateOutput(raw);

      if (!validation.valid) {
        return fallback('invalid_output');
      }

      const rewrittenQuestion = validation.text;
      const rewriteUsed =
        rewrittenQuestion.toLowerCase() !== originalQuestion.trim().toLowerCase();

      const durationMs = Date.now() - startMs;
      this.logger.info(
        { requestId, rewriteUsed, durationMs, fallbackReason: null },
        'query_rewrite_completed',
      );

      return { rewrittenQuestion, rewriteUsed, fallbackReason: null };
    } catch (err) {
      clearTimeout(timer);

      // AbortController fires a DOMException with name 'AbortError', but the
      // openai SDK may also wrap it.  Check both the error itself and its cause.
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        (err instanceof Error &&
          err.cause instanceof Error &&
          err.cause.name === 'AbortError');

      return fallback(isAbort ? 'timeout' : 'api_error');
    }
  }
}
