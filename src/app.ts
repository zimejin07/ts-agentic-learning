import { Hono } from 'hono';
import type { AppDatabase } from './db/client.js';
import { jobRoutes } from './jobs/routes.js';
import type { JobQueue } from './jobs/types.js';
import { errorHandler } from './middleware/error.js';
import { requestId, type AppEnv } from './middleware/request-id.js';
import { todoRoutes } from './todos/routes.js';

export interface AppDeps {
  db: AppDatabase;
  /** When omitted, POST /todos still works but does not enqueue email jobs. */
  queue?: JobQueue;
}

/**
 * App factory — tests pass an in-memory db (+ MemoryQueue); the server passes
 * a file-backed db and a BullMQ queue when REDIS_URL is set.
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requestId);
  app.onError(errorHandler);

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/todos', todoRoutes(deps.db, deps.queue));
  if (deps.queue) {
    app.route('/jobs', jobRoutes(deps.db, deps.queue));
  }
  return app;
}
