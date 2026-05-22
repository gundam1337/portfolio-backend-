import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module';
import { QueryRewriterModule } from '../query-rewriter/query-rewriter.module';
import { SessionModule } from '../../shared/session/session.module';
import { InputGuardService } from './input-guard.service';
import { SanitizationPipe } from './pipes/sanitization.pipe';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  imports: [
    SessionModule,
    QueryRewriterModule,
    EmbeddingModule,
  ],
  controllers: [QueryController],
  // SanitizationPipe must be in providers so NestJS can inject PinoLogger
  // into it via DI when it's instantiated by @UsePipes(SanitizationPipe).
  providers: [QueryService, InputGuardService, SanitizationPipe],
})
export class QueryModule {}
