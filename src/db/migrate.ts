/**
 * CLI helper: `pnpm db:migrate`
 * The API also runs this SQL on boot, so you rarely need the script.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createDb, getDatabasePath } from './client.js';

const databasePath = getDatabasePath();
if (databasePath !== ':memory:') {
  mkdirSync(path.dirname(databasePath), { recursive: true });
}
const { sqlite } = createDb(databasePath);
sqlite.close();
console.log(`Migrated ${databasePath}`);
