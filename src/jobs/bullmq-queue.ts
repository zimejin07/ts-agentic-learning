import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { DEFAULT_JOB_ATTEMPTS, type JobName, type JobQueue, type JobRecord } from './types.js';

export const QUEUE_NAME = 'default';

export function createRedis(url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export class BullmqQueue implements JobQueue {
  constructor(private readonly queue: Queue) {}

  async add(
    name: JobName,
    data: Record<string, unknown>,
    opts?: { jobId?: string },
  ): Promise<{ id: string }> {
    const job = await this.queue.add(name, data, {
      jobId: opts?.jobId,
      attempts: DEFAULT_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: 500 },
      removeOnComplete: false,
      removeOnFail: false,
    });
    const id = job.id;
    if (!id) throw new Error('BullMQ returned a job without an id');
    return { id };
  }

  async getJob(id: string): Promise<JobRecord | null> {
    const job = await this.queue.getJob(id);
    if (!job) return null;
    const state = await job.getState();
    return {
      id: job.id ?? id,
      name: job.name as JobName,
      data: (job.data ?? {}) as Record<string, unknown>,
      state: mapState(state),
      attemptsMade: job.attemptsMade,
    };
  }
}

function mapState(state: string): JobRecord['state'] {
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  if (state === 'active') return 'active';
  return 'waiting';
}

export function createBullmqQueue(connection: Redis): BullmqQueue {
  return new BullmqQueue(new Queue(QUEUE_NAME, { connection }));
}
