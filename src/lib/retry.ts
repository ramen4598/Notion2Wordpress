// Description: Utility functions for retrying operations with exponential backoff

import { logger } from './logger.js';
import { config } from '../config/index.js';

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

  const {
    maxAttempts = config.maxRetryAttempts,
    initialDelayMs = config.retryInitialDelayMs,
    maxDelayMs = config.retryMaxDelayMs,
    backoffMultiplier = config.retryBackoffMultiplier,
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