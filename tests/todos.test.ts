import { describe, expect, it, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';

function app() {
  const { db } = createDb(':memory:');
  return createApp({ db });
}

describe('health', () => {
  it('returns ok', async () => {
    const res = await app().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('todos CRUD', () => {
  let client: ReturnType<typeof app>;

  beforeEach(() => {
    client = app();
  });

  it('creates, lists, fetches, patches, and deletes a todo', async () => {
    const created = await client.request('/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Learn Hono' }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      todo: { id: string; title: string; completed: boolean };
    };
    expect(body.todo.title).toBe('Learn Hono');
    expect(body.todo.completed).toBe(false);
    const id = body.todo.id;

    const list = await client.request('/todos');
    const listed = (await list.json()) as { todos: unknown[] };
    expect(listed.todos).toHaveLength(1);

    const got = await client.request(`/todos/${id}`);
    expect(got.status).toBe(200);

    const patched = await client.request(`/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { todo: { completed: boolean } };
    expect(patchedBody.todo.completed).toBe(true);

    const deleted = await client.request(`/todos/${id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);

    const missing = await client.request(`/todos/${id}`);
    expect(missing.status).toBe(404);
  });

  it('rejects an empty title with 400 and a requestId', async () => {
    const res = await client.request('/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-test' },
      body: JSON.stringify({ title: '' }),
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: string; requestId: string };
    expect(payload.requestId).toBe('req-test');
    expect(payload.error).toBeTruthy();
  });

  it('rejects a non-uuid id with 400', async () => {
    const res = await client.request('/todos/not-a-uuid');
    expect(res.status).toBe(400);
  });
});
