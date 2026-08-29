import { Worker, type Job } from 'bullmq';
import { createRedis, QUEUE_NAME } from './jobs/bullmq-queue.js';
import { processJob } from './jobs/processors.js';
import type { JobName } from './jobs/types.js';

/**
 * Consumer process: `pnpm worker`
 * Requires Redis (`docker compose up -d redis`).
 *
 * BullMQ calls this handler once per attempt. `job.attemptsMade` is 0-based
 * on the first try in some versions — we treat attempt as attemptsMade + 1
 * so logs read naturally (attempt 1, 2, 3).
 */
const connection = createRedis();

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    await processJob(job.name as JobName, (job.data ?? {}) as Record<string, unknown>, {
      jobId: job.id ?? 'unknown',
      attempt: job.attemptsMade + 1,
    });
  },
  { connection },
);

worker.on('ready', () => {
  console.log(JSON.stringify({ level: 'info', message: 'worker ready', queue: QUEUE_NAME }));
});

worker.on('failed', (job, err) => {
  console.error(
    JSON.stringify({
      level: 'error',
      jobId: job?.id,
      name: job?.name,
      attempt: job ? job.attemptsMade : undefined,
      message: err.message,
    }),
  );
});
