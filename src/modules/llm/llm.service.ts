import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import OpenAI from 'openai';
import type { Env } from '../../config/env.validation';
import { OPENAI_CLIENT } from '../../shared/openai/openai.constants';
import type { ChatMessage } from '../prompt/prompt.types';

const COMPLETE_TIMEOUT_MS = 30_000;
const SUGGESTIONS_TIMEOUT_MS = 8_000;

const SUGGESTIONS_SYSTEM = `You are a helpful assistant. Given a question about Omar Derkaoui's portfolio and the answer provided, suggest exactly 3 concise follow-up questions a visitor might ask next. Output ONLY a JSON array of 3 strings. No markdown, no explanation.`;

export interface LlmResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

@Injectable()
export class LlmService {
  private readonly model: string;

  constructor(
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAI,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(LlmService.name);
    this.model = config.get('OPENAI_CHAT_MODEL', { infer: true });
  }

  async complete(messages: ChatMessage[], requestId: string): Promise<LlmResult> {
    const startMs = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMPLETE_TIMEOUT_MS);

    this.logger.debug({ requestId, model: this.model, messageCount: messages.length }, 'llm_complete_started');

    try {
      const response = await this.openai.chat.completions.create(
        { model: this.model, messages, temperature: 0.3 },
        { signal: controller.signal },
      );
      clearTimeout(timer);

      const text = response.choices[0]?.message?.content ?? '';
      const usage = response.usage;

      this.logger.info(
        { requestId, durationMs: Date.now() - startMs, promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens },
        'answer_generated',
      );

      return {
        text,
        model: response.model,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      clearTimeout(timer);
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        (err instanceof Error && err.cause instanceof Error && err.cause.name === 'AbortError');

      this.logger.error(
        { requestId, error: isAbort ? 'timeout' : (err instanceof Error ? err.message : String(err)), durationMs: Date.now() - startMs },
        'llm_complete_failed',
      );

      throw new ServiceUnavailableException(
        'The AI service is temporarily unavailable. Please try again shortly.',
      );
    }
  }

  async suggestFollowUps(question: string, answer: string, requestId: string): Promise<string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUGGESTIONS_TIMEOUT_MS);

    try {
      const response = await this.openai.chat.completions.create(
        {
          model: this.model,
          temperature: 0.7,
          max_tokens: 200,
          messages: [
            { role: 'system', content: SUGGESTIONS_SYSTEM },
            { role: 'user', content: `Question: ${question}\nAnswer: ${answer}` },
          ],
        },
        { signal: controller.signal },
      );
      clearTimeout(timer);

      const raw = response.choices[0]?.message?.content ?? '[]';
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        return (parsed as string[]).slice(0, 3);
      }
      return [];
    } catch {
      clearTimeout(timer);
      this.logger.warn({ requestId }, 'llm_suggestions_failed');
      return [];
    }
  }
}
