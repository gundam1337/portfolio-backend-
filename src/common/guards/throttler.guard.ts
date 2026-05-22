import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  // With trustProxy: true on FastifyAdapter, req.ip already reflects the real
  // client IP from X-Forwarded-For — this override makes the intent explicit
  // and adds a safe fallback.
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const fastifyReq = req as unknown as FastifyRequest;
    return (
      fastifyReq.ip ??
      (fastifyReq.socket as { remoteAddress?: string } | undefined)?.remoteAddress ??
      'unknown'
    );
  }
}
