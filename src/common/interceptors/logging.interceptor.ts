import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(LoggingInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const { method, url, id: requestId } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.logger.info(
          { requestId, method, url, durationMs: Date.now() - start },
          'request completed',
        );
      }),
    );
  }
}
