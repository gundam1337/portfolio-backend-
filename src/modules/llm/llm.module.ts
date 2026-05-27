import { Module } from '@nestjs/common';
import { OpenAIModule } from '../../shared/openai/openai.module';
import { LlmService } from './llm.service';

@Module({
  imports: [OpenAIModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
