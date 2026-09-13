import { describe, expect, it } from 'vitest';
import {
  fingerprintCall,
  isRetryableError,
  trimMessages,
  withRetry,
} from '../src/agent/loop-guards.js';
import type { ChatMessage } from '../src/types/index.js';

describe('fingerprintCall', () => {
  it('treats key order as irrelevant', () => {
    expect(fingerprintCall('calculator', { b: 2, a: 1 })).toBe(
      fingerprintCall('calculator', { a: 1, b: 2 }),
    );
  });
});

describe('isRetryableError', () => {
  it('retries 429 and 5xx only', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError(new Error('Aborted'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('retries a 429 then succeeds', async () => {
    let hits = 0;
    const result = await withRetry(
      async () => {
        hits++;
        if (hits < 3) throw Object.assign(new Error('slow down'), { status: 429 });
        return 'ok';
      },
      { extraAttempts: 2, delayMs: 0 },
    );
    expect(result).toBe('ok');
    expect(hits).toBe(3);
  });

  it('does not retry a 400', async () => {
    let hits = 0;
    await expect(
      withRetry(
        async () => {
          hits++;
          throw Object.assign(new Error('bad request'), { status: 400 });
        },
        { extraAttempts: 3, delayMs: 0 },
      ),
    ).rejects.toThrow('bad request');
    expect(hits).toBe(1);
  });
});

describe('trimMessages', () => {
  it('keeps the goal plus the last N assistant/user pairs', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a3' },
      { role: 'user', content: 'u3' },
    ];
    const { messages: trimmed, droppedPairs } = trimMessages(messages, 1);
    expect(droppedPairs).toBe(2);
    expect(trimmed).toEqual([
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: 'a3' },
      { role: 'user', content: 'u3' },
    ]);
  });
});
