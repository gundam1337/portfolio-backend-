import { Module } from '@nestjs/common';
import { InputGuardService } from './input-guard.service';
import { SanitizationPipe } from './pipes/sanitization.pipe';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  controllers: [QueryController],
  // SanitizationPipe must be in providers so NestJS can inject PinoLogger
  // into it via DI when it's instantiated by @UsePipes(SanitizationPipe).
  // Without this, the constructor injection would fail at runtime.
  providers: [QueryService, InputGuardService, SanitizationPipe],
})
export class QueryModule {}
