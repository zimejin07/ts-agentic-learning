import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(here, '../../drizzle/0000_init.sql');

/**
 * Opens SQLite and applies the SQL migration if needed.
 * Pass ':memory:' for tests so nothing touches disk.
 */
export function createDb(databasePath: string): {
  db: AppDatabase;
  sqlite: InstanceType<typeof Database>;
} {
  const sqlite = new Database(databasePath);
  if (databasePath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  const sql = readFileSync(migrationPath, 'utf8');
  sqlite.exec(sql);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH ?? 'data/app.db';
}
