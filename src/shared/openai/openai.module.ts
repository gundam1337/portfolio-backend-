import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { Env } from '../../config/env.validation';
import { OPENAI_CLIENT } from './openai.constants';

@Module({
  providers: [
    {
      provide: OPENAI_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): OpenAI =>
        new OpenAI({ apiKey: config.get('OPENAI_API_KEY', { infer: true }) }),
    },
  ],
  exports: [OPENAI_CLIENT],
})
export class OpenAIModule {}
