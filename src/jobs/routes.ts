import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDatabase } from '../db/client.js';
import { validate } from '../http/validate.js';
import type { AppEnv } from '../middleware/request-id.js';
import { findIdempotent, saveIdempotent } from './idempotency.js';
import type { JobQueue } from './types.js';

const webhookSchema = z.object({
  url: z.string().url(),
  payload: z.record(z.string(), z.unknown()).optional(),
  /** First N attempts fail on purpose so retries are visible. */
  failTimes: z.number().int().min(0).max(5).optional(),
});

const jobIdSchema = z.object({
  id: z.string().min(1),
});

export function jobRoutes(db: AppDatabase, queue: JobQueue): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/webhooks', validate('json', webhookSchema), async (c) => {
    const key = c.req.header('idempotency-key');
    if (key) {
      const replay = await findIdempotent(db, key, 'POST', '/jobs/webhooks');
      if (replay) return c.json(replay.body, replay.status as 200);
    }

    const body = c.req.valid('json');
    const job = await queue.add('webhook_retry', {
      url: body.url,
      payload: body.payload ?? {},
      failTimes: body.failTimes ?? 0,
    });
    const response = { job: { id: job.id, name: 'webhook_retry' as const } };
    if (key) await saveIdempotent(db, key, 'POST', '/jobs/webhooks', 202, response);
    return c.json(response, 202);
  });

  app.get('/:id', validate('param', jobIdSchema), async (c) => {
    const { id } = c.req.valid('param');
    const job = await queue.getJob(id);
    if (!job) return c.json({ error: `Job ${id} not found`, requestId: c.get('requestId') }, 404);
    return c.json({ job });
  });

  return app;
}
