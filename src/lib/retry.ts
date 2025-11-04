// Description: Utility functions for retrying operations with exponential backoff

import { logger } from './logger.js';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  onRetry?: (error: Error, attempt: number) => void;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const getNum = (value: string | undefined, fallback: number) => {
    if (!value) return fallback;
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const defaults = {
    maxAttempts: getNum(process.env.MAX_RETRY_ATTEMPTS, 3),
    initialDelayMs: getNum(process.env.RETRY_INITIAL_DELAY_MS, 1000),
    maxDelayMs: getNum(process.env.RETRY_MAX_DELAY_MS, 30000),
    backoffMultiplier: getNum(process.env.RETRY_BACKOFF_MULTIPLIER, 2),
  } as const; // "as const" to make properties readonly

  const {
    maxAttempts = defaults.maxAttempts,
    initialDelayMs = defaults.initialDelayMs,
    maxDelayMs = defaults.maxDelayMs,
    backoffMultiplier = defaults.backoffMultiplier,
    onRetry,
  } = options;

  let lastError: Error;
  let currentDelay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error; // error must be of type Error

      if (attempt === maxAttempts) {
        logger.error(`Max retry attempts (${maxAttempts}) exceeded`, lastError);
        throw lastError;
      }

      logger.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${currentDelay}ms`, {
        error: lastError.message,
      });

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt);
      }

      await sleep(currentDelay);

      // Exponential backoff
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRateLimitError(error: any): boolean {
  return (
    error?.status === 429 ||
    error?.code === 'rate_limited' ||
    error?.message?.toLowerCase().includes('rate limit')
  );
}

// TODO: onRetry 콜백에서 사용하도록 변경할 것.
// This function can be used in retryWithBackoff's onRetry to determine if we should retry
export function shouldRetry(error: any): boolean {
  // Retry on rate limits, network errors, and 5xx errors
  if (isRateLimitError(error)) return true;
  if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT') return true;
  if (error?.status >= 500 && error?.status < 600) return true;
  return false;
}
