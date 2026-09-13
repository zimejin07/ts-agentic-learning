import { describe, expect, it } from 'vitest';
import { runAgent } from '../src/agent/loop.js';
import { tools } from '../src/tools/index.js';
import { executeTool } from '../src/tools/index.js';
import type { ContentBlock, LlmClient, LlmResponse } from '../src/types/index.js';

class FakeClient implements LlmClient {
  constructor(private queue: LlmResponse[]) {}

  async complete(): Promise<LlmResponse> {
    const next = this.queue.shift();
    if (!next) throw new Error('FakeClient ran out of queued responses');
    return next;
  }
}

class FlakyThenOk implements LlmClient {
  private failsLeft: number;
  constructor(
    failsLeft: number,
    private queue: LlmResponse[],
  ) {
    this.failsLeft = failsLeft;
  }

  async complete(): Promise<LlmResponse> {
    if (this.failsLeft > 0) {
      this.failsLeft--;
      throw Object.assign(new Error('rate limited'), { status: 429 });
    }
    const next = this.queue.shift();
    if (!next) throw new Error('FlakyThenOk ran out of queued responses');
    return next;
  }
}

const text = (value: string, usage?: LlmResponse['usage']): LlmResponse => ({
  stopReason: 'end_turn',
  content: [{ type: 'text', text: value } satisfies ContentBlock],
  usage,
});

const tool = (
  name: string,
  input: Record<string, unknown>,
  usage?: LlmResponse['usage'],
): LlmResponse => ({
  stopReason: 'tool_use',
  content: [{ type: 'tool_use', id: `id-${name}`, name, input } satisfies ContentBlock],
  usage,
});

const PLAN = '{"steps":[{"id":1,"description":"Work"}]}';

describe('loop engineering', () => {
  it('blocks a repeated tool call with the same arguments', async () => {
    const client = new FakeClient([
      text(PLAN),
      tool('calculator', { expression: '1 + 1' }),
      tool('calculator', { expression: '1 + 1' }),
      text('Two.'),
    ]);

    const result = await runAgent({
      goal: 'Add',
      client,
      tools,
      maxIterations: 8,
      retryAttempts: 0,
      keepLastTurns: 0,
    });

    const blocked = result.trace.filter((event) => event.message.includes('Blocked repeat'));
    expect(blocked).toHaveLength(1);
    const observes = result.trace.filter((event) => event.type === 'observe');
    expect(observes[1]?.message).toContain('already called');
    expect(result.answer).toBe('Two.');
  });

  it('stops when the token budget is exhausted', async () => {
    const usage = { inputTokens: 80, outputTokens: 20 };
    const client = new FakeClient([
      text(PLAN, usage),
      text('Not enough budget to continue.', usage),
    ]);

    const result = await runAgent({
      goal: 'Spend',
      client,
      tools,
      maxIterations: 8,
      tokenBudget: 150,
      retryAttempts: 0,
      keepLastTurns: 0,
    });

    expect(result.hitTokenBudget).toBe(true);
    expect(result.tokensUsed).toBe(200);
    expect(result.answer).toContain('token budget');
  });

  it('retries a 429 on the planning call then continues', async () => {
    const client = new FlakyThenOk(2, [text(PLAN), text('Recovered.')]);
    const result = await runAgent({
      goal: 'Retry me',
      client,
      tools,
      maxIterations: 8,
      retryAttempts: 2,
      retryDelayMs: 0,
      keepLastTurns: 0,
    });
    expect(result.answer).toBe('Recovered.');
  });

  it('trims old turns before the next LLM call', async () => {
    const client = new FakeClient([
      text(PLAN),
      tool('calculator', { expression: '1+1' }),
      tool('calculator', { expression: '2+2' }),
      text('Done.'),
    ]);

    const result = await runAgent({
      goal: 'Trim',
      client,
      tools,
      maxIterations: 8,
      retryAttempts: 0,
      keepLastTurns: 1,
    });

    expect(result.trace.some((event) => event.message.includes('Trimmed'))).toBe(true);
    expect(result.answer).toBe('Done.');
  });
});

describe('Zod at the tool boundary', () => {
  it('rejects bad calculator args before execute', async () => {
    const result = await executeTool('calculator', { expression: 42 });
    expect(result).toMatch(/^Error: invalid arguments/);
  });
});
