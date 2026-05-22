export interface RetryOptions {
  /** Max total attempts (first call + retries). Default: 3. */
  maxAttempts?: number;
  /** Delay in ms before each retry attempt (index 0 = before attempt 2). */
  delaysMs?: number[];
  /** Return true if the error is transient and should be retried. */
  isRetryable?: (err: unknown) => boolean;
}

const DEFAULT_DELAYS_MS = [1_000, 3_000];

function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const status = (err as unknown as { status?: number }).status;
    if (typeof status === 'number') {
      // 429 (rate-limit) and 5xx (server errors) are transient
      return status === 429 || status >= 500;
    }
    // Network / timeout errors have no status — treat as transient
    return true;
  }
  return true;
}

/**
 * Calls `fn` up to `maxAttempts` times, waiting `delaysMs[i]` before each
 * retry.  Non-retryable errors (e.g. 4xx client errors other than 429) are
 * re-thrown immediately without consuming remaining attempts.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const delays = opts.delaysMs ?? DEFAULT_DELAYS_MS;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      if (!isRetryable(err)) {
        throw err;
      }

      if (attempt < maxAttempts) {
        const delayMs = delays[attempt - 1] ?? 0;
        if (delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
  }

  throw lastErr;
}
