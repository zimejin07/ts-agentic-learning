import { describe, expect, it } from 'vitest';
import { runAgent } from '../src/agent/loop.js';
import { tools } from '../src/tools/index.js';
import type { ContentBlock, LlmClient, LlmResponse } from '../src/types/index.js';

/**
 * A scripted fake LLM. The agent loop only knows the LlmClient interface,
 * so tests can replay canned responses and never touch the network or an
 * API key. Each call to complete() pops the next response off the queue.
 */
class FakeClient implements LlmClient {
  private queue: LlmResponse[];
  readonly requestCount = { value: 0 };

  constructor(queue: LlmResponse[]) {
    this.queue = [...queue];
  }

  async complete(): Promise<LlmResponse> {
    this.requestCount.value++;
    const next = this.queue.shift();
    if (!next) throw new Error('FakeClient ran out of queued responses');
    return next;
  }
}

const text = (value: string): ContentBlock => ({ type: 'text', text: value });
const toolUse = (name: string, input: Record<string, unknown>): ContentBlock => ({
  type: 'tool_use',
  id: `fake-${name}-1`,
  name,
  input,
});

const PLAN_JSON = '{"steps":[{"id":1,"description":"Compute something"}]}';

describe('runAgent', () => {
  it('runs plan -> act -> observe -> answer and returns a full trace', async () => {
    const client = new FakeClient([
      { stopReason: 'end_turn', content: [text(PLAN_JSON)] },
      { stopReason: 'tool_use', content: [toolUse('calculator', { expression: '24 * 7' })] },
      { stopReason: 'end_turn', content: [text('24 * 7 is 168.')] },
    ]);

    const result = await runAgent({ goal: 'What is 24 * 7?', client, tools, maxIterations: 8 });

    expect(result.answer).toContain('168');
    expect(result.hitMaxIterations).toBe(false);
    expect(result.plan.steps).toHaveLength(1);

    const types = result.trace.map((event) => event.type);
    expect(types).toContain('plan');
    expect(types).toContain('act');
    expect(types).toContain('observe');
    expect(types).toContain('answer');
    // The observation should carry the real tool output.
    const observe = result.trace.find((event) => event.type === 'observe');
    expect(observe?.message).toBe('168');
  });

  it('survives the model hallucinating an unknown tool', async () => {
    const client = new FakeClient([
      { stopReason: 'end_turn', content: [text(PLAN_JSON)] },
      { stopReason: 'tool_use', content: [toolUse('time_machine', { year: 1969 })] },
      { stopReason: 'end_turn', content: [text('I cannot time travel, but here is an answer.')] },
    ]);

    const result = await runAgent({ goal: 'Go back to 1969', client, tools, maxIterations: 8 });

    const observe = result.trace.find((event) => event.type === 'observe');
    expect(observe?.message).toContain('unknown tool');
    expect(result.answer).toContain('cannot time travel');
  });

  it('falls back to a single-step plan when the plan is unparseable', async () => {
    const client = new FakeClient([
      { stopReason: 'end_turn', content: [text('I refuse to output JSON.')] },
      { stopReason: 'end_turn', content: [text('Done anyway.')] },
    ]);

    const result = await runAgent({ goal: 'Do the thing', client, tools, maxIterations: 8 });

    expect(result.plan.steps).toEqual([{ id: 1, description: 'Do the thing' }]);
    expect(result.trace.some((event) => event.type === 'warning')).toBe(true);
    expect(result.answer).toBe('Done anyway.');
  });

  it('stops at the max iteration cap instead of looping forever', async () => {
    const client = new FakeClient([
      { stopReason: 'end_turn', content: [text(PLAN_JSON)] },
      // The model keeps calling tools forever...
      { stopReason: 'tool_use', content: [toolUse('calculator', { expression: '1 + 1' })] },
      { stopReason: 'tool_use', content: [toolUse('calculator', { expression: '2 + 2' })] },
    ]);

    const result = await runAgent({ goal: 'Add forever', client, tools, maxIterations: 2 });

    expect(result.hitMaxIterations).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.trace.some((event) => event.message.includes('Max iteration cap'))).toBe(true);
  });
});
