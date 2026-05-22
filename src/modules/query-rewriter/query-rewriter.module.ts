import { Module } from '@nestjs/common';
import { OpenAIModule } from '../../shared/openai/openai.module';
import { QueryRewriterService } from './query-rewriter.service';

@Module({
  imports: [OpenAIModule],
  providers: [QueryRewriterService],
  exports: [QueryRewriterService],
})
export class QueryRewriterModule {}
