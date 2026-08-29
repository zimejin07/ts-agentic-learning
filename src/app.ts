import { Hono } from 'hono';
import type { AppDatabase } from './db/client.js';
import { errorHandler } from './middleware/error.js';
import { requestId, type AppEnv } from './middleware/request-id.js';
import { todoRoutes } from './todos/routes.js';

/**
 * App factory — tests pass an in-memory db; the server passes a file-backed one.
 * Keeping Hono construction here (not in index.ts) is what makes request() tests easy.
 */
export function createApp(db: AppDatabase): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requestId);
  app.onError(errorHandler);

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/todos', todoRoutes(db));
  return app;
}
