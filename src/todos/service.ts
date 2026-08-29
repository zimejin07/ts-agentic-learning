import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AppDatabase } from '../db/client.js';
import { todos, type TodoRow } from '../db/schema.js';
import type { TodoDto } from './schemas.js';

export function toDto(row: TodoRow): TodoDto {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function listTodos(db: AppDatabase): Promise<TodoDto[]> {
  const rows = await db.select().from(todos).orderBy(todos.createdAt);
  return rows.map(toDto);
}

export async function getTodo(db: AppDatabase, id: string): Promise<TodoDto> {
  const rows = await db.select().from(todos).where(eq(todos.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new HTTPException(404, { message: `Todo ${id} not found` });
  return toDto(row);
}

export async function createTodo(db: AppDatabase, title: string): Promise<TodoDto> {
  const row: TodoRow = {
    id: crypto.randomUUID(),
    title,
    completed: false,
    createdAt: new Date(),
  };
  await db.insert(todos).values(row);
  return toDto(row);
}

export async function patchTodo(
  db: AppDatabase,
  id: string,
  patch: { title?: string; completed?: boolean },
): Promise<TodoDto> {
  await getTodo(db, id);
  await db
    .update(todos)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
    })
    .where(eq(todos.id, id));
  return getTodo(db, id);
}

export async function deleteTodo(db: AppDatabase, id: string): Promise<void> {
  await getTodo(db, id);
  await db.delete(todos).where(eq(todos.id, id));
}
