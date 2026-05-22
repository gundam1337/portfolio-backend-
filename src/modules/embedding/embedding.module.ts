import { Module } from '@nestjs/common';
import { OpenAIModule } from '../../shared/openai/openai.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [OpenAIModule, RedisModule],
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
