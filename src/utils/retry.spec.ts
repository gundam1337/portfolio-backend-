import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retryWithBackoff } from './retry';

// Speed up tests: override delays to 0ms
const FAST_OPTS = { maxAttempts: 3, delaysMs: [0, 0] };

function makeStatusError(status: number): Error {
  const err = new Error(`HTTP ${status}`);
  (err as unknown as { status: number }).status = status;
  return err;
}

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns the result on the first successful call', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, FAST_OPTS);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a 5xx error and succeeds on the second attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeStatusError(500))
      .mockResolvedValueOnce('ok');

    const result = await retryWithBackoff(fn, FAST_OPTS);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeStatusError(429))
      .mockResolvedValueOnce('ok');

    const result = await retryWithBackoff(fn, FAST_OPTS);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 401 (client error)', async () => {
    const err = makeStatusError(401);
    const fn = vi.fn().mockRejectedValue(err);

    await expect(retryWithBackoff(fn, FAST_OPTS)).rejects.toThrow('HTTP 401');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 400 (bad request)', async () => {
    const err = makeStatusError(400);
    const fn = vi.fn().mockRejectedValue(err);

    await expect(retryWithBackoff(fn, FAST_OPTS)).rejects.toThrow('HTTP 400');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts all retries then throws the last error', async () => {
    const err = makeStatusError(503);
    const fn = vi.fn().mockRejectedValue(err);

    await expect(retryWithBackoff(fn, FAST_OPTS)).rejects.toThrow('HTTP 503');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on network errors (no status property)', async () => {
    const networkErr = new Error('ECONNRESET');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(networkErr)
      .mockResolvedValueOnce('ok');

    const result = await retryWithBackoff(fn, FAST_OPTS);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('respects a custom isRetryable predicate', async () => {
    const err = makeStatusError(503);
    const fn = vi.fn().mockRejectedValue(err);

    // never retry
    await expect(
      retryWithBackoff(fn, { ...FAST_OPTS, isRetryable: () => false }),
    ).rejects.toThrow('HTTP 503');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
