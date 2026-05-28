import { Module } from '@nestjs/common';
import { OpenAIModule } from '../../shared/openai/openai.module';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [OpenAIModule],
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
