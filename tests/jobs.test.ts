import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { MemoryQueue } from '../src/jobs/memory-queue.js';
import { processJob } from '../src/jobs/processors.js';

function withQueue() {
  const { db } = createDb(':memory:');
  const queue = new MemoryQueue();
  return { app: createApp({ db, queue }), queue };
}

describe('POST /todos enqueues send_email', () => {
  it('records a send_email job and is idempotent on Idempotency-Key', async () => {
    const { app, queue } = withQueue();
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'create-1',
    };
    const first = await app.request('/todos', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Email me' }),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { todo: { id: string }; jobId: string };
    expect(firstBody.jobId).toBeTruthy();
    expect(queue.jobs.size).toBe(1);

    const second = await app.request('/todos', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Email me' }),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { todo: { id: string }; jobId: string };
    expect(secondBody.todo.id).toBe(firstBody.todo.id);
    expect(secondBody.jobId).toBe(firstBody.jobId);
    expect(queue.jobs.size).toBe(1);
  });
});

describe('POST /jobs/webhooks', () => {
  it('enqueues webhook_retry and GET /jobs/:id returns it', async () => {
    const { app, queue } = withQueue();
    const created = await app.request('/jobs/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', failTimes: 1 }),
    });
    expect(created.status).toBe(202);
    const body = (await created.json()) as { job: { id: string } };
    const listed = [...queue.jobs.values()];
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('webhook_retry');

    const got = await app.request(`/jobs/${body.job.id}`);
    expect(got.status).toBe(200);
    const jobBody = (await got.json()) as { job: { state: string } };
    expect(jobBody.job.state).toBe('waiting');
  });
});

describe('processJob retries', () => {
  it('fails the first N attempts then succeeds', async () => {
    await expect(
      processJob(
        'webhook_retry',
        { url: 'https://example.com', failTimes: 2 },
        { jobId: 'j1', attempt: 1 },
      ),
    ).rejects.toThrow(/attempt 1/);
    await expect(
      processJob(
        'webhook_retry',
        { url: 'https://example.com', failTimes: 2 },
        { jobId: 'j1', attempt: 2 },
      ),
    ).rejects.toThrow(/attempt 2/);
    await expect(
      processJob(
        'webhook_retry',
        { url: 'https://example.com', failTimes: 2 },
        { jobId: 'j1', attempt: 3 },
      ),
    ).resolves.toBeUndefined();
  });

  it('send_email always succeeds (mock)', async () => {
    await expect(
      processJob('send_email', { todoId: 'abc' }, { jobId: 'j2', attempt: 1 }),
    ).resolves.toBeUndefined();
  });
});
