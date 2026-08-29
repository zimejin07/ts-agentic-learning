import type { JobName, JobQueue, JobRecord } from './types.js';

/**
 * In-memory queue for tests. Jobs sit in `waiting` until a test inspects them.
 * Does not execute processors — that is covered separately so tests stay sync-ish.
 */
export class MemoryQueue implements JobQueue {
  readonly jobs = new Map<string, JobRecord>();

  async add(
    name: JobName,
    data: Record<string, unknown>,
    opts?: { jobId?: string },
  ): Promise<{ id: string }> {
    const id = opts?.jobId ?? crypto.randomUUID();
    this.jobs.set(id, { id, name, data, state: 'waiting', attemptsMade: 0 });
    return { id };
  }

  async getJob(id: string): Promise<JobRecord | null> {
    return this.jobs.get(id) ?? null;
  }
}
