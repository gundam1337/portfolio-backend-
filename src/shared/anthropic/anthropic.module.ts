import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../../config/env.validation';
import { ANTHROPIC_CLIENT } from './anthropic.constants';

@Module({
  providers: [
    {
      provide: ANTHROPIC_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Anthropic =>
        new Anthropic({ apiKey: config.get('ANTHROPIC_API_KEY', { infer: true }) }),
    },
  ],
  exports: [ANTHROPIC_CLIENT],
})
export class AnthropicModule {}
