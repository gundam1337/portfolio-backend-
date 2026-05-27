import { Module } from '@nestjs/common';
import { CohereModule } from '../../shared/cohere/cohere.module';
import { RerankerService } from './reranker.service';

@Module({
  imports: [CohereModule],
  providers: [RerankerService],
  exports: [RerankerService],
})
export class RerankerModule {}
