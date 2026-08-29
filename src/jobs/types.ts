/**
 * Queue port. The API is the producer; the worker is the consumer.
 * Tests inject MemoryQueue so CI does not need Redis.
 */
export type JobName = 'send_email' | 'webhook_retry';

export interface JobRecord {
  id: string;
  name: JobName;
  data: Record<string, unknown>;
  state: 'waiting' | 'active' | 'completed' | 'failed';
  attemptsMade: number;
}

export interface JobQueue {
  add(
    name: JobName,
    data: Record<string, unknown>,
    opts?: { jobId?: string },
  ): Promise<{ id: string }>;
  getJob(id: string): Promise<JobRecord | null>;
}

export const DEFAULT_JOB_ATTEMPTS = 3;
