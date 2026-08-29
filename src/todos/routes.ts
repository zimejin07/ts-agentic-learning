import { Hono } from 'hono';
import type { AppDatabase } from '../db/client.js';
import { validate } from '../http/validate.js';
import { findIdempotent, saveIdempotent } from '../jobs/idempotency.js';
import type { JobQueue } from '../jobs/types.js';
import type { AppEnv } from '../middleware/request-id.js';
import { createTodoSchema, patchTodoSchema, todoIdSchema } from './schemas.js';
import * as service from './service.js';

export function todoRoutes(db: AppDatabase, queue?: JobQueue): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const items = await service.listTodos(db);
    return c.json({ todos: items });
  });

  app.get('/:id', validate('param', todoIdSchema), async (c) => {
    const { id } = c.req.valid('param');
    const todo = await service.getTodo(db, id);
    return c.json({ todo });
  });

  app.post('/', validate('json', createTodoSchema), async (c) => {
    const key = c.req.header('idempotency-key');
    if (key) {
      const replay = await findIdempotent(db, key, 'POST', '/todos');
      if (replay) return c.json(replay.body as object, replay.status as 201);
    }

    const { title } = c.req.valid('json');
    const todo = await service.createTodo(db, title);
    let jobId: string | undefined;
    if (queue) {
      const job = await queue.add('send_email', { todoId: todo.id, title: todo.title });
      jobId = job.id;
    }
    const body = { todo, jobId };
    if (key) await saveIdempotent(db, key, 'POST', '/todos', 201, body);
    return c.json(body, 201);
  });

  app.patch(
    '/:id',
    validate('param', todoIdSchema),
    validate('json', patchTodoSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const todo = await service.patchTodo(db, id, patch);
      return c.json({ todo });
    },
  );

  app.delete('/:id', validate('param', todoIdSchema), async (c) => {
    const { id } = c.req.valid('param');
    await service.deleteTodo(db, id);
    return c.body(null, 204);
  });

  return app;
}
