// Pure token counting and text splitting utilities for the chunking pipeline.
// Uses js-tiktoken (pure JS, no native/WASM bindings) so it builds cleanly
// on Render without extra build steps.
//
// The encoder is initialized once at module load — getEncoding() is expensive
// (~20ms) and its result is reusable and thread-safe (no mutable state).

import { getEncoding, type TiktokenEncoding } from 'js-tiktoken';

const ENCODING: TiktokenEncoding = 'cl100k_base'; // matches text-embedding-3-large

// Single encoder instance shared across all calls in this process.
const enc = getEncoding(ENCODING);

/**
 * Returns the number of cl100k_base tokens in `text`.
 */
export function countTokens(text: string): number {
  return enc.encode(text).length;
}

/**
 * Splits `text` into overlapping windows of at most `maxTokens` tokens.
 * Consecutive windows share `overlapTokens` of content from the tail of the
 * previous window — this is the token-level fallback used when paragraph
 * boundaries are unavailable or produce oversized paragraphs.
 *
 * Implementation notes:
 * - Encodes the whole text once, then slices the token array (O(n) overall).
 * - js-tiktoken's enc.decode() returns a string directly (unlike tiktoken
 *   which returns Uint8Array), so no TextDecoder is needed.
 * - Round-trip may shift UTF-8 boundaries by a character but that's fine —
 *   we only care about size bounds, not exact alignment.
 * - When overlapTokens >= maxTokens the overlap is clamped to maxTokens-1 to
 *   prevent infinite loops (every step must advance by at least one token).
 */
export function splitByTokens(
  text: string,
  maxTokens: number,
  overlapTokens: number,
): string[] {
  const tokens = enc.encode(text);
  if (tokens.length === 0) return [];

  const safeOverlap = Math.min(overlapTokens, maxTokens - 1);
  const step = maxTokens - safeOverlap; // how many NEW tokens each window adds
  const chunks: string[] = [];

  for (let start = 0; start < tokens.length; start += step) {
    const slice = tokens.slice(start, start + maxTokens);
    // enc.decode() returns a string directly in js-tiktoken.
    chunks.push(enc.decode(slice) as unknown as string);
  }

  return chunks;
}
