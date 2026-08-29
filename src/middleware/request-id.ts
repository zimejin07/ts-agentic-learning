import { createMiddleware } from 'hono/factory';

export type AppEnv = {
  Variables: {
    requestId: string;
  };
};

/**
 * Every response carries X-Request-Id so logs and error bodies can be correlated.
 * Clients may send their own id; otherwise we generate one.
 */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && incoming.trim() ? incoming.trim() : crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
});
