import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * SQLite stores booleans as 0/1 integers. The HTTP layer maps these to real
 * JSON booleans so callers never see the storage detail.
 */
export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export type TodoRow = typeof todos.$inferSelect;

export const idempotencyKeys = sqliteTable('idempotency_keys', {
  key: text('key').primaryKey(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: text('response_body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
