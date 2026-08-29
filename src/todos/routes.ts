import { Hono } from 'hono';
import type { AppDatabase } from '../db/client.js';
import { validate } from '../http/validate.js';
import type { AppEnv } from '../middleware/request-id.js';
import { createTodoSchema, patchTodoSchema, todoIdSchema } from './schemas.js';
import * as service from './service.js';

export function todoRoutes(db: AppDatabase): Hono<AppEnv> {
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
    const { title } = c.req.valid('json');
    const todo = await service.createTodo(db, title);
    return c.json({ todo }, 201);
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
