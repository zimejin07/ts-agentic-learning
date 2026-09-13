import type { ChatMessage } from '../types/index.js';

/**
 * Loop engineering helpers — the bits that make the agent a *control system*,
 * not just a while-loop around an LLM.
 *
 * Kept in one file on purpose: a learning repo should let you read the
 * invariants in a single sitting.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function totalTokens(usage: TokenUsage | undefined): number {
  if (!usage) return 0;
  return usage.inputTokens + usage.outputTokens;
}

/** Stable fingerprint so `{a:1,b:2}` and `{b:2,a:1}` count as the same call. */
export function fingerprintCall(name: string, input: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(sortKeys(input))}`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

/**
 * Drop the oldest assistant/user *pairs* after the opening goal message.
 * We never split a tool_use from its tool_result — that would 400 the API.
 *
 * `keepLastTurns` is the number of pairs to keep. 0 means "do not trim".
 */
export function trimMessages(
  messages: ChatMessage[],
  keepLastTurns: number,
): { messages: ChatMessage[]; droppedPairs: number } {
  if (keepLastTurns <= 0 || messages.length <= 1) {
    return { messages, droppedPairs: 0 };
  }
  const goal = messages[0];
  if (!goal) return { messages, droppedPairs: 0 };
  const rest = messages.slice(1);
  const pairCount = Math.floor(rest.length / 2);
  if (pairCount <= keepLastTurns) {
    return { messages, droppedPairs: 0 };
  }
  const droppedPairs = pairCount - keepLastTurns;
  const tail = rest.slice(droppedPairs * 2);
  return { messages: [goal, ...tail], droppedPairs };
}

/**
 * Retry only transient provider failures (429 / 5xx). A 400 is a bug in *our*
 * request and retrying it would just burn tokens.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.message === 'Aborted') return false;
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number((error as { status: unknown }).status);
    return status === 429 || (Number.isFinite(status) && status >= 500);
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { extraAttempts: number; delayMs: number; abortSignal?: AbortSignal },
): Promise<T> {
  const attempts = Math.max(1, options.extraAttempts + 1);
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (options.abortSignal?.aborted) throw new Error('Aborted');
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const canRetry = isRetryableError(error) && i < attempts - 1;
      if (!canRetry) throw error;
      if (options.delayMs > 0) {
        await sleep(options.delayMs * 2 ** i);
      }
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
