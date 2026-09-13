import type { JobName } from './types.js';

export interface JobLog {
  jobId: string;
  name: JobName;
  attempt: number;
  durationMs: number;
  status: 'ok' | 'error';
  message: string;
}

function log(entry: JobLog): void {
  console.log(JSON.stringify({ level: 'info', ...entry }));
}

/**
 * Job handlers. Pure-ish functions so tests can call them without Redis.
 *
 * send_email — mock only, no SMTP.
 * webhook_retry — mock HTTP. If `failTimes` is N, the first N attempts throw
 * so BullMQ's retry/backoff can be demonstrated.
 */
export async function processJob(
  name: JobName,
  data: Record<string, unknown>,
  meta: { jobId: string; attempt: number },
): Promise<void> {
  const started = Date.now();
  try {
    if (name === 'send_email') {
      const to = typeof data.todoId === 'string' ? data.todoId : 'unknown';
      log({
        jobId: meta.jobId,
        name,
        attempt: meta.attempt,
        durationMs: Date.now() - started,
        status: 'ok',
        message: `mock email for todo ${to}`,
      });
      return;
    }

    if (name === 'webhook_retry') {
      const failTimes = typeof data.failTimes === 'number' ? data.failTimes : 0;
      if (meta.attempt <= failTimes) {
        throw new Error(`mock webhook failed on attempt ${meta.attempt}`);
      }
      log({
        jobId: meta.jobId,
        name,
        attempt: meta.attempt,
        durationMs: Date.now() - started,
        status: 'ok',
        message: `mock webhook delivered to ${String(data.url ?? '')}`,
      });
      return;
    }

    throw new Error(`Unknown job name: ${name}`);
  } catch (error) {
    log({
      jobId: meta.jobId,
      name,
      attempt: meta.attempt,
      durationMs: Date.now() - started,
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
