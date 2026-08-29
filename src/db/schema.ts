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
