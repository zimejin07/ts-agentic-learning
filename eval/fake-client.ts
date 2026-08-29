import type { LlmClient, LlmResponse } from '../src/types/index.js';

/**
 * Scripted LLM used by the eval runner. Same idea as tests/loop.test.ts:
 * no network, no API key, deterministic.
 */
export class FakeClient implements LlmClient {
  private queue: LlmResponse[];

  constructor(queue: LlmResponse[]) {
    this.queue = [...queue];
  }

  async complete(): Promise<LlmResponse> {
    const next = this.queue.shift();
    if (!next) throw new Error('FakeClient ran out of queued responses');
    return next;
  }
}
