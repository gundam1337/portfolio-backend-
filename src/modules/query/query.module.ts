import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module';
import { QueryRewriterModule } from '../query-rewriter/query-rewriter.module';
import { SessionModule } from '../../shared/session/session.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { RerankerModule } from '../reranking/reranker.module';
import { PromptModule } from '../prompt/prompt.module';
import { InputGuardService } from './input-guard.service';
import { SanitizationPipe } from './pipes/sanitization.pipe';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  imports: [
    SessionModule,
    QueryRewriterModule,
    EmbeddingModule,
    RetrievalModule,
    RerankerModule,
    PromptModule,
  ],
  controllers: [QueryController],
  providers: [QueryService, InputGuardService, SanitizationPipe],
})
export class QueryModule {}
