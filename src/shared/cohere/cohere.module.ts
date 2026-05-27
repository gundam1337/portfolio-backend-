import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CohereClientV2 } from 'cohere-ai';
import type { Env } from '../../config/env.validation';
import { COHERE_CLIENT } from './cohere.constants';

@Module({
  providers: [
    {
      provide: COHERE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): CohereClientV2 => {
        const token = config.get('COHERE_API_KEY', { infer: true });
        Logger.log('Cohere client initialized', 'CohereModule');
        return new CohereClientV2({ token });
      },
    },
  ],
  exports: [COHERE_CLIENT],
})
export class CohereModule {}
