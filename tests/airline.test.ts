import { beforeEach, describe, expect, it } from 'vitest';
import {
  FLIGHTS,
  fareIdFor,
  findFlightByFareId,
  getBookings,
  getFareTool,
  resetAirlineStore,
  searchFlightsTool,
} from '../src/tools/airline.js';
import { executeTool } from '../src/tools/index.js';

beforeEach(() => {
  resetAirlineStore();
});

describe('search_flights', () => {
  it('lists SFO→JFK on 2026-09-15 under $400 (morning fares, not DL300)', async () => {
    const result = await searchFlightsTool.execute({
      origin: 'SFO',
      destination: 'JFK',
      date: '2026-09-15',
      max_price: 400,
    });
    expect(result).toContain('FARE-AA100-2026-09-15');
    expect(result).toContain('FARE-UA200-2026-09-15');
    expect(result).not.toContain('DL300');
  });

  it('uppercases IATA codes at the registry', async () => {
    const result = await executeTool('search_flights', {
      origin: 'sfo',
      destination: 'jfk',
      date: '2026-09-15',
    });
    expect(result).toContain('FARE-AA100-2026-09-15');
  });

  it('says when nothing matches', async () => {
    const result = await searchFlightsTool.execute({
      origin: 'SFO',
      destination: 'JFK',
      date: '1999-01-01',
    });
    expect(result).toContain('No flights found');
  });
});

describe('get_fare + book_flight registry', () => {
  it('quotes a known fare', async () => {
    const flight = FLIGHTS[0]!;
    const result = await getFareTool.execute({ fare_id: fareIdFor(flight) });
    expect(result).toContain('Quoted');
    expect(result).toContain(flight.number);
  });

  it('rejects unknown fare_id without prompting HITL', async () => {
    let prompted = 0;
    const result = await executeTool(
      'book_flight',
      { fare_id: 'FARE-NOPE-2026-09-15', passenger: 'Ada Lovelace' },
      {
        onApprove: async () => {
          prompted += 1;
          return true;
        },
      },
    );
    expect(prompted).toBe(0);
    expect(result).toContain('unknown fare_id');
    expect(getBookings()).toHaveLength(0);
  });

  it('rejects an unquoted fare without prompting HITL', async () => {
    let prompted = 0;
    const fareId = fareIdFor(FLIGHTS[0]!);
    const result = await executeTool(
      'book_flight',
      { fare_id: fareId, passenger: 'Ada Lovelace' },
      {
        onApprove: async () => {
          prompted += 1;
          return true;
        },
      },
    );
    expect(prompted).toBe(0);
    expect(result).toContain('not quoted');
    expect(getBookings()).toHaveLength(0);
  });

  it('books after quote when the human approves', async () => {
    const fareId = fareIdFor(FLIGHTS[0]!);
    await executeTool('get_fare', { fare_id: fareId });
    const result = await executeTool(
      'book_flight',
      { fare_id: fareId, passenger: 'Ada Lovelace' },
      { onApprove: async () => true },
    );
    expect(result).toContain('PNR-1001');
    expect(getBookings()).toHaveLength(1);
    expect(getBookings()[0]?.passenger).toBe('Ada Lovelace');
  });

  it('does not book when the human declines', async () => {
    const fareId = fareIdFor(FLIGHTS[0]!);
    await executeTool('get_fare', { fare_id: fareId });
    const result = await executeTool(
      'book_flight',
      { fare_id: fareId, passenger: 'Ada Lovelace' },
      { onApprove: async () => false },
    );
    expect(result).toContain('user declined');
    expect(getBookings()).toHaveLength(0);
  });

  it('denies HITL tools when no approver is configured', async () => {
    const fareId = fareIdFor(FLIGHTS[0]!);
    await executeTool('get_fare', { fare_id: fareId });
    const result = await executeTool('book_flight', {
      fare_id: fareId,
      passenger: 'Ada Lovelace',
    });
    expect(result).toContain('user declined');
    expect(getBookings()).toHaveLength(0);
  });
});

describe('fare ids', () => {
  it('round-trips catalog flights', () => {
    for (const flight of FLIGHTS) {
      expect(findFlightByFareId(fareIdFor(flight))).toEqual(flight);
    }
  });
});
