import { beforeEach, describe, expect, it } from 'vitest';
import { runAgent } from '../src/agent/loop.js';
import { fareIdFor, FLIGHTS, getBookings, resetAirlineStore } from '../src/tools/airline.js';
import { tools } from '../src/tools/index.js';
import type { ContentBlock, LlmClient, LlmResponse } from '../src/types/index.js';

class FakeClient implements LlmClient {
  constructor(private queue: LlmResponse[]) {}

  async complete(): Promise<LlmResponse> {
    const next = this.queue.shift();
    if (!next) throw new Error('FakeClient ran out of queued responses');
    return next;
  }
}

const text = (value: string): LlmResponse => ({
  stopReason: 'end_turn',
  content: [{ type: 'text', text: value } satisfies ContentBlock],
});

const tool = (name: string, input: Record<string, unknown>, id: string): LlmResponse => ({
  stopReason: 'tool_use',
  content: [{ type: 'tool_use', id, name, input } satisfies ContentBlock],
});

const PLAN =
  '{"steps":[{"id":1,"description":"Search flights"},{"id":2,"description":"Quote a fare"},{"id":3,"description":"Book"}]}';

const AA100 = fareIdFor(FLIGHTS[0]!);

function searchQuoteBook(finalText: string): LlmResponse[] {
  return [
    text(PLAN),
    tool(
      'search_flights',
      { origin: 'SFO', destination: 'JFK', date: '2026-09-15', max_price: 400 },
      'id-search',
    ),
    tool('get_fare', { fare_id: AA100 }, 'id-fare'),
    tool('book_flight', { fare_id: AA100, passenger: 'Ada Lovelace' }, 'id-book'),
    text(finalText),
  ];
}

beforeEach(() => {
  resetAirlineStore();
});

describe('HITL booking workflow', () => {
  it('search → quote → approve → PNR in the answer', async () => {
    const prompts: string[] = [];
    const client = new FakeClient(
      searchQuoteBook('Booked AA100 for Ada Lovelace. Confirmation PNR-1001.'),
    );

    const result = await runAgent({
      goal: 'Find a morning SFO to JFK on 2026-09-15 under $400 and book it for Ada Lovelace.',
      client,
      tools,
      maxIterations: 8,
      retryAttempts: 0,
      keepLastTurns: 0,
      onApprove: async (request) => {
        prompts.push(request.summary);
        return true;
      },
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Ada Lovelace');
    expect(prompts[0]).toContain('AA100');
    expect(result.answer).toContain('PNR-1001');
    expect(getBookings()).toHaveLength(1);
    expect(result.trace.some((event) => event.type === 'approve')).toBe(true);
    const observeBook = result.trace.filter((event) => event.type === 'observe').at(-1);
    expect(observeBook?.message).toContain('PNR-1001');
  });

  it('search → quote → deny → no ticket, model can still answer', async () => {
    const client = new FakeClient(
      searchQuoteBook(
        'Booking was declined. AA100 at $329 is still available if you change your mind.',
      ),
    );

    const result = await runAgent({
      goal: 'Book a cheap SFO-JFK for Ada Lovelace.',
      client,
      tools,
      maxIterations: 8,
      retryAttempts: 0,
      keepLastTurns: 0,
      onApprove: async () => false,
    });

    expect(getBookings()).toHaveLength(0);
    expect(result.answer).toContain('declined');
    expect(result.trace.some((event) => event.message.includes('User declined'))).toBe(true);
    const observes = result.trace.filter((event) => event.type === 'observe');
    expect(observes.at(-1)?.message).toContain('user declined');
  });

  it('does not prompt HITL for an unknown fare_id', async () => {
    let prompted = 0;
    const client = new FakeClient([
      text(PLAN),
      tool(
        'book_flight',
        { fare_id: 'FARE-ZZ999-2026-09-15', passenger: 'Ada Lovelace' },
        'id-bad',
      ),
      text('That fare does not exist.'),
    ]);

    const result = await runAgent({
      goal: 'Book a made-up fare',
      client,
      tools,
      maxIterations: 8,
      retryAttempts: 0,
      keepLastTurns: 0,
      onApprove: async () => {
        prompted += 1;
        return true;
      },
    });

    expect(prompted).toBe(0);
    expect(getBookings()).toHaveLength(0);
    expect(result.trace.find((event) => event.type === 'observe')?.message).toContain(
      'unknown fare_id',
    );
  });

  it('blocks a second identical book_flight after a decline (stuck-call fingerprint)', async () => {
    let prompted = 0;
    const client = new FakeClient([
      text(PLAN),
      tool('get_fare', { fare_id: AA100 }, 'id-fare'),
      tool('book_flight', { fare_id: AA100, passenger: 'Ada Lovelace' }, 'id-book-1'),
      tool('book_flight', { fare_id: AA100, passenger: 'Ada Lovelace' }, 'id-book-2'),
      text('I will not retry the same booking.'),
    ]);

    const result = await runAgent({
      goal: 'Book AA100 for Ada',
      client,
      tools,
      maxIterations: 8,
      retryAttempts: 0,
      keepLastTurns: 0,
      onApprove: async () => {
        prompted += 1;
        return false;
      },
    });

    expect(prompted).toBe(1);
    expect(getBookings()).toHaveLength(0);
    expect(result.trace.some((event) => event.message.includes('Blocked repeat'))).toBe(true);
  });
});
