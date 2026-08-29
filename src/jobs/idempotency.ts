import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Replay cache keyed by Idempotency-Key + method + path.
 * A duplicate POST with the same key returns the original status/body instead
 * of creating a second todo or enqueueing a second job.
 */
export async function findIdempotent(
  db: AppDatabase,
  key: string,
  method: string,
  path: string,
): Promise<StoredResponse | null> {
  const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.method !== method || row.path !== path) {
    return { status: 409, body: { error: 'Idempotency-Key reused on a different request' } };
  }
  return { status: row.responseStatus, body: JSON.parse(row.responseBody) as unknown };
}

export async function saveIdempotent(
  db: AppDatabase,
  key: string,
  method: string,
  path: string,
  status: number,
  body: unknown,
): Promise<void> {
  await db.insert(idempotencyKeys).values({
    key,
    method,
    path,
    responseStatus: status,
    responseBody: JSON.stringify(body),
    createdAt: new Date(),
  });
}
