import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import decancer from 'decancer';
import type { QueryRequestDto } from '../dto/query-request.dto';

// ─── pure function ────────────────────────────────────────────────────────────

/**
 * Applies every sanitization transformation in order and returns the cleaned
 * string.  Exported standalone so unit tests can call it without the DI
 * container — no need to spin up a NestJS application in unit tests.
 *
 * decancer handles: unicode normalization, homoglyphs, zero-width chars,
 * bidi overrides, control characters, diacritics, and leetspeak confusables.
 * The WHITESPACE_RUN step follows because decancer does not collapse runs.
 */
export function sanitizeQuestion(raw: string): string {
  return decancer(raw)
    .toString()
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── NestJS pipe ─────────────────────────────────────────────────────────────

/**
 * Per-route sanitization pipe, registered with @UsePipes(SanitizationPipe)
 * on the POST /api/query handler only — not globally.
 *
 * Why not global?  Sanitization is specific to free-text fields.  Silently
 * mutating structured values like UUIDs, enum strings, or numeric IDs in
 * other DTOs would introduce subtle bugs.
 *
 * How to attach to a single route handler (cleanest NestJS pattern):
 *
 *   @Post()
 *   @UsePipes(SanitizationPipe)          // ← pipe applied after global pipes
 *   query(@Body() dto: QueryRequestDto, @Req() req: FastifyRequest) { … }
 *
 * Execution order on each incoming request:
 *   1. Global ValidationPipe  — type-checks and validates raw DTO fields.
 *   2. SanitizationPipe (this) — normalizes the already-validated question.
 *   3. Route handler           — receives a clean, validated QueryRequestDto.
 *
 * NestJS resolves constructor dependencies via DI exactly like a provider,
 * so PinoLogger is injected automatically once QueryModule registers this
 * pipe in its providers array.
 */
@Injectable()
export class SanitizationPipe implements PipeTransform<QueryRequestDto, QueryRequestDto> {
  constructor(
    @InjectPinoLogger(SanitizationPipe.name)
    private readonly logger: PinoLogger,
  ) {}

  transform(value: QueryRequestDto, _metadata: ArgumentMetadata): QueryRequestDto {
    const raw = value.question;
    const clean = sanitizeQuestion(raw);

    if (clean !== raw) {
      // Log metadata only — never raw or cleaned content — so PII and prompt
      // text never appear in the log stream.
      // Security signal: a high removedChars rate from a single IP often
      // indicates automated invisible-character probing to test whether the
      // filter can be bypassed.  This structured line is queryable in any
      // log aggregator (Datadog, CloudWatch, Loki).
      this.logger.info(
        {
          event: 'input_sanitized',
          rawLength: raw.length,
          cleanLength: clean.length,
          removedChars: raw.length - clean.length,
        },
        'input_sanitized',
      );
    }

    if (clean.length === 0) {
      // The field passed MinLength(3) on the raw bytes (e.g. three zero-width
      // spaces pass the byte-length check) but collapsed to "" after
      // sanitization.  Throw with a precise message so the caller understands
      // this is an invisible-character issue, not a missing field.
      throw new BadRequestException(
        'question is empty after sanitization — it may contain only whitespace or invisible characters',
      );
    }

    return { ...value, question: clean };
  }
}
