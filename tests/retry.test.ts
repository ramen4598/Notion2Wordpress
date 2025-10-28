import { describe, it, expect } from 'vitest';
import { retryWithBackoff } from '../src/lib/retry.js';

describe('retryWithBackoff', () => {
  it('resolves on first attempt', async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls++;
      return 'ok';
    }, { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2, backoffMultiplier: 1 });

    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls++;
      if (calls < 3) {
        throw new Error('temporary');
      }
      return 42;
    }, { maxAttempts: 5, initialDelayMs: 1, maxDelayMs: 2, backoffMultiplier: 1 });

    expect(result).toBe(42);
    expect(calls).toBe(3);
  });

  it('throws after exhausting attempts', async () => {
    let calls = 0;
    await expect(retryWithBackoff(async () => {
      calls++;
      throw new Error('fail');
    }, { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2, backoffMultiplier: 1 }))
      .rejects.toThrow('fail');

    expect(calls).toBe(2);
  });
});
