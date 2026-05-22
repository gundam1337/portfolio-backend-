import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { InputGuardService } from './input-guard.service';

// InputGuardService has no constructor dependencies — instantiate directly.
const guard = new InputGuardService();

// Helper: call validateQuestion and return the thrown BadRequestException's
// response object, which is where our structured { error, detail } lives.
// NestJS puts the object passed to new BadRequestException({ … }) in
// exception.getResponse() / exception.response.
function getErrorResponse(question: string): { error: string; detail: string } {
  try {
    guard.validateQuestion(question);
  } catch (err) {
    if (err instanceof BadRequestException) {
      return err.getResponse() as { error: string; detail: string };
    }
  }
  throw new Error('Expected BadRequestException but none was thrown');
}

describe('InputGuardService.validateQuestion', () => {
  // ── Passing cases ────────────────────────────────────────────────────────────

  it('accepts a normal English question', () => {
    expect(() =>
      guard.validateQuestion('What technologies does Omar use?'),
    ).not.toThrow();
  });

  it('accepts a question with symbols below the 50% threshold', () => {
    // "C++ is great!" — 3 non-alphanumeric out of 14 total ≈ 21%
    expect(() => guard.validateQuestion('C++ is great!')).not.toThrow();
  });

  it('accepts a multilingual (Arabic) question', () => {
    // Arabic letters satisfy \p{L} — the guard must not reject non-Latin scripts
    expect(() => guard.validateQuestion('ما هي التقنيات')).not.toThrow();
  });

  it('accepts a question containing a URL (symbols still < 50%)', () => {
    expect(() =>
      guard.validateQuestion('Does omar use https://nextjs.org in his stack?'),
    ).not.toThrow();
  });

  // ── Too short ────────────────────────────────────────────────────────────────

  it('throws BadRequestException when question is fewer than 3 characters', () => {
    expect(() => guard.validateQuestion('hi')).toThrow(BadRequestException);
  });

  it('includes "too short" in the error message', () => {
    const resp = getErrorResponse('a');
    expect(resp.error).toMatch(/too short/);
  });

  it('includes the actual length in the detail message', () => {
    const resp = getErrorResponse('hi');
    expect(resp.detail).toContain('2');
  });

  // ── No alphabetic characters ─────────────────────────────────────────────────

  it('throws when question contains only digits', () => {
    expect(() => guard.validateQuestion('12345')).toThrow(BadRequestException);
  });

  it('includes "no alphabetic" in the error message for digit-only input', () => {
    const resp = getErrorResponse('99999');
    expect(resp.error).toMatch(/no alphabetic/);
  });

  it('throws when question contains only punctuation', () => {
    expect(() => guard.validateQuestion('???...!!!')).toThrow(
      BadRequestException,
    );
  });

  // ── Punctuation ratio > 50% ──────────────────────────────────────────────────

  it('throws when more than 50% of characters are non-alphanumeric', () => {
    // "a!@#$%" — 1 alphanumeric out of 6 = 83% non-alphanumeric
    expect(() => guard.validateQuestion('a!@#$%')).toThrow(BadRequestException);
  });

  it('includes "too many non-alphanumeric" in the error for symbol-heavy input', () => {
    // "a!@#$%" has letters (passes the alpha check) but 83% are non-alphanumeric
    const resp = getErrorResponse('a!@#$%');
    expect(resp.error).toMatch(/too many non-alphanumeric/);
  });

  it('accepts exactly 50% non-alphanumeric (boundary — not over limit)', () => {
    // "ab!!" — 2 alphanumeric, 2 non-alphanumeric = exactly 50% → allowed
    expect(() => guard.validateQuestion('ab!!')).not.toThrow();
  });

  it('throws at 51% non-alphanumeric (just over boundary)', () => {
    // 49 letters + 51 symbols in a 100-char string
    const q = 'a'.repeat(49) + '!'.repeat(51);
    expect(() => guard.validateQuestion(q)).toThrow(BadRequestException);
  });

  it('includes the percentage in the detail message', () => {
    // "a!@#$%" — has a letter (passes alpha check), but 83% non-alphanumeric
    const resp = getErrorResponse('a!@#$%');
    expect(resp.detail).toMatch(/\d+%/);
  });

  // ── Error type ────────────────────────────────────────────────────────────────

  it('throws BadRequestException (HTTP 400) not a 500 error', () => {
    try {
      guard.validateQuestion('12345');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
    }
  });
});
