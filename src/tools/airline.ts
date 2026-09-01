import { z } from 'zod';
import type { ToolDefinition } from '../types/index.js';

/**
 * In-memory fake airline. Deterministic, no network, safe for tests — the same
 * idea as mock web_search, but this one has a write: booking.
 *
 * Workflow the agent is meant to follow:
 *   search_flights (read) -> get_fare (read, locks a quote) -> book_flight (HITL)
 */

export interface Flight {
  number: string;
  origin: string;
  destination: string;
  date: string;
  departs: string;
  arrives: string;
  priceUsd: number;
}

export const FLIGHTS: Flight[] = [
  {
    number: 'AA100',
    origin: 'SFO',
    destination: 'JFK',
    date: '2026-09-15',
    departs: '07:15',
    arrives: '16:05',
    priceUsd: 329,
  },
  {
    number: 'UA200',
    origin: 'SFO',
    destination: 'JFK',
    date: '2026-09-15',
    departs: '09:40',
    arrives: '18:20',
    priceUsd: 389,
  },
  {
    number: 'DL300',
    origin: 'SFO',
    destination: 'JFK',
    date: '2026-09-15',
    departs: '13:00',
    arrives: '21:45',
    priceUsd: 455,
  },
  {
    number: 'AA400',
    origin: 'SFO',
    destination: 'JFK',
    date: '2026-09-16',
    departs: '08:00',
    arrives: '16:50',
    priceUsd: 310,
  },
  {
    number: 'UA500',
    origin: 'LAX',
    destination: 'JFK',
    date: '2026-09-15',
    departs: '06:30',
    arrives: '15:10',
    priceUsd: 275,
  },
  {
    number: 'B6900',
    origin: 'SFO',
    destination: 'BOS',
    date: '2026-09-15',
    departs: '07:00',
    arrives: '15:40',
    priceUsd: 198,
  },
];

export interface Booking {
  pnr: string;
  fareId: string;
  passenger: string;
  flight: Flight;
}

const quotedFareIds = new Set<string>();
const bookings: Booking[] = [];
let pnrSeq = 0;

export function fareIdFor(flight: Flight): string {
  return `FARE-${flight.number}-${flight.date}`;
}

export function findFlightByFareId(fareId: string): Flight | undefined {
  return FLIGHTS.find((flight) => fareIdFor(flight) === fareId);
}

export function getBookings(): readonly Booking[] {
  return bookings;
}

/** Tests call this so each case starts with an empty ticket counter. */
export function resetAirlineStore(): void {
  quotedFareIds.clear();
  bookings.length = 0;
  pnrSeq = 0;
}

function formatFlight(flight: Flight): string {
  return `${fareIdFor(flight)} | ${flight.number} | ${flight.origin}→${flight.destination} | ${flight.date} ${flight.departs}–${flight.arrives} | $${flight.priceUsd}`;
}

const iata = z
  .string()
  .length(3)
  .regex(/^[A-Za-z]{3}$/)
  .transform((code) => code.toUpperCase());

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const searchFlightsTool: ToolDefinition = {
  name: 'search_flights',
  description:
    'Search the mock airline for flights. Returns fare_id lines. Read-only — does not book.',
  inputSchema: {
    type: 'object',
    properties: {
      origin: { type: 'string', description: '3-letter IATA, e.g. SFO' },
      destination: { type: 'string', description: '3-letter IATA, e.g. JFK' },
      date: { type: 'string', description: 'Departure date YYYY-MM-DD' },
      max_price: { type: 'number', description: 'Optional maximum price in USD' },
    },
    required: ['origin', 'destination', 'date'],
  },
  argsSchema: z.object({
    origin: iata,
    destination: iata,
    date: isoDate,
    max_price: z.number().positive().optional(),
  }),
  execute: (input) => {
    const origin = String(input.origin);
    const destination = String(input.destination);
    const date = String(input.date);
    const maxPrice = typeof input.max_price === 'number' ? input.max_price : undefined;
    const hits = FLIGHTS.filter((flight) => {
      if (flight.origin !== origin || flight.destination !== destination || flight.date !== date) {
        return false;
      }
      if (maxPrice !== undefined && flight.priceUsd > maxPrice) return false;
      return true;
    });
    if (hits.length === 0) {
      return `No flights found for ${origin}→${destination} on ${date}${maxPrice !== undefined ? ` under $${maxPrice}` : ''}. Try SFO→JFK on 2026-09-15.`;
    }
    return `${hits.map(formatFlight).join('\n')}\nCall get_fare with a fare_id to lock a quote before booking.`;
  },
};

export const getFareTool: ToolDefinition = {
  name: 'get_fare',
  description:
    'Lock a quote for a fare_id from search_flights. Read-only. Required before book_flight.',
  inputSchema: {
    type: 'object',
    properties: {
      fare_id: {
        type: 'string',
        description: 'Id from search_flights, e.g. FARE-AA100-2026-09-15',
      },
    },
    required: ['fare_id'],
  },
  argsSchema: z.object({ fare_id: z.string().min(1) }),
  execute: (input) => {
    const fareId = String(input.fare_id);
    const flight = findFlightByFareId(fareId);
    if (!flight) {
      return `Error: unknown fare_id "${fareId}". Search flights first.`;
    }
    quotedFareIds.add(fareId);
    return [
      `Quoted ${fareId}`,
      `${flight.number} ${flight.origin}→${flight.destination} on ${flight.date}`,
      `Departs ${flight.departs}, arrives ${flight.arrives}`,
      `USD ${flight.priceUsd}`,
      'Next: book_flight with this fare_id and the passenger full name. Booking waits for human approval.',
    ].join('\n');
  },
};

function bookingPreflight(input: Record<string, unknown>): string | undefined {
  const fareId = String(input.fare_id);
  const flight = findFlightByFareId(fareId);
  if (!flight) {
    return `Error: unknown fare_id "${fareId}". Search flights first.`;
  }
  if (!quotedFareIds.has(fareId)) {
    return `Error: fare "${fareId}" is not quoted. Call get_fare before booking.`;
  }
  if (bookings.some((booking) => booking.fareId === fareId)) {
    return `Error: fare "${fareId}" is already booked.`;
  }
  return undefined;
}

function bookingSummary(input: Record<string, unknown>): string {
  const fareId = String(input.fare_id);
  const passenger = String(input.passenger);
  const flight = findFlightByFareId(fareId);
  if (!flight) return `Book ${fareId} for ${passenger}`;
  return `Book ${flight.number} ${flight.origin}→${flight.destination} on ${flight.date} ${flight.departs} for ${passenger} at $${flight.priceUsd}`;
}

export const bookFlightTool: ToolDefinition = {
  name: 'book_flight',
  description:
    'Issue a mock ticket for a quoted fare_id. THIS IS IRREVERSIBLE in the demo: it waits for a human to type y/n (or --yes). Do not call until get_fare succeeded.',
  inputSchema: {
    type: 'object',
    properties: {
      fare_id: { type: 'string', description: 'Quoted fare_id from get_fare' },
      passenger: { type: 'string', description: 'Passenger full name' },
    },
    required: ['fare_id', 'passenger'],
  },
  argsSchema: z.object({
    fare_id: z.string().min(1),
    passenger: z.string().trim().min(1).max(80),
  }),
  requiresApproval: true,
  preflight: bookingPreflight,
  approvalSummary: bookingSummary,
  execute: (input) => {
    const fareId = String(input.fare_id);
    const passenger = String(input.passenger);
    const flight = findFlightByFareId(fareId);
    if (!flight) {
      return `Error: unknown fare_id "${fareId}".`;
    }
    pnrSeq += 1;
    const pnr = `PNR-${1000 + pnrSeq}`;
    bookings.push({ pnr, fareId, passenger, flight });
    return `Booked. ${pnr} | ${flight.number} ${flight.origin}→${flight.destination} ${flight.date} | ${passenger} | USD ${flight.priceUsd}\nThis is a mock confirmation (no real ticket was issued).`;
  },
};
