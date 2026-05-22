import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ThrottlerException } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const requestId = request.id as string;

    // ThrottlerException extends HttpException — must be checked first
    if (exception instanceof ThrottlerException) {
      void reply.code(HttpStatus.TOO_MANY_REQUESTS).send({
        error: 'Too many requests',
        requestId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as Record<string, unknown>).message ?? exception.message);

      void reply.code(status).send({ error: message, requestId });
      return;
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(
      { requestId, err, stack: err.stack },
      `Unhandled exception: ${err.message}`,
    );

    void reply.code(HttpStatus.INTERNAL_SERVER_ERROR).send({
      error: 'Internal server error',
      requestId,
    });
  }
}
