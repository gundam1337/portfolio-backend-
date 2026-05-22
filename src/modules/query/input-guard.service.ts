import { BadRequestException, Injectable } from '@nestjs/common';

// Matches any Unicode letter.  The \p{L} category covers all scripts
// (Latin, Arabic, CJK, Cyrillic, …), not just ASCII [a-zA-Z].
// The `u` flag is required for Unicode property escapes.
const UNICODE_LETTER = /\p{L}/u;

// Matches a single Unicode letter or decimal digit.
// Used to calculate the alphanumeric ratio of the input.
const ALPHANUMERIC_CHAR = /[\p{L}\p{N}]/u;

/**
 * InputGuardService — semantic validation that runs AFTER sanitization.
 *
 * ValidationPipe checks structure (types, lengths, required fields).
 * SanitizationPipe normalises the string.
 * This service checks meaning: is the sanitized text actually a question
 * a human might ask?  It is the last line of defence before the string
 * reaches the LLM, where prompt-injection cost is highest.
 *
 * Injected into QueryController and called at the very start of the handler
 * so that rejection happens before any further business logic runs.
 */
@Injectable()
export class InputGuardService {
  /**
   * Validates that the sanitized question meets semantic requirements.
   * Throws BadRequestException with a structured message on failure.
   * Returns void on success — the caller just continues.
   */
  validateQuestion(question: string): void {
    // Re-check length here even though MinLength(3) runs on the raw string.
    // SanitizationPipe can shorten the string (e.g. a 5-char string of
    // zero-width chars collapses to ""), but SanitizationPipe already throws
    // for the empty case.  This check catches the 1–2 char post-sanitization
    // edge cases that slipped through the DTO's raw-string MinLength(3).
    if (question.length < 3) {
      throw new BadRequestException({
        error: 'question too short after sanitization',
        detail: `minimum 3 characters required, got ${question.length}`,
      });
    }

    // Reject strings with zero alphabetic characters.
    // A question with no letters is almost certainly not a natural-language
    // query — it's either automated noise or an attempt to probe the system
    // with pure symbols/numbers.  We use \p{L} to support non-Latin scripts
    // (e.g. Arabic, CJK) so legitimate multilingual users are not penalised.
    if (!UNICODE_LETTER.test(question)) {
      throw new BadRequestException({
        error: 'question contains no alphabetic characters',
        detail:
          'a valid question must contain at least one letter (any script)',
      });
    }

    // Reject strings that are more than 50% non-alphanumeric.
    // e.g. "!@#$%^&*()" or "???...!!!" are not natural-language questions.
    // This blocks punctuation-heavy probing payloads while allowing real
    // questions that happen to include symbols (URLs, code snippets, "C++").
    const totalChars = question.length;
    const alphanumericCount = [...question].filter((ch) =>
      ALPHANUMERIC_CHAR.test(ch),
    ).length;
    const nonAlphanumericRatio = (totalChars - alphanumericCount) / totalChars;

    if (nonAlphanumericRatio > 0.5) {
      throw new BadRequestException({
        error: 'question contains too many non-alphanumeric characters',
        detail: `${Math.round(nonAlphanumericRatio * 100)}% of characters are symbols or punctuation (limit 50%)`,
      });
    }
  }
}
