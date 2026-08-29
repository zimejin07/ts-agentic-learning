import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDb, getDatabasePath } from './db/client.js';
import { createBullmqQueue, createRedis } from './jobs/bullmq-queue.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const databasePath = getDatabasePath();
if (databasePath !== ':memory:') {
  mkdirSync(path.dirname(databasePath), { recursive: true });
}

const { db } = createDb(databasePath);
const redisUrl = process.env.REDIS_URL;
const queue = redisUrl ? createBullmqQueue(createRedis(redisUrl)) : undefined;
if (!queue) {
  console.warn('REDIS_URL not set — jobs will not be enqueued. API CRUD still works.');
}

const app = createApp({ db, queue });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Todos API listening on http://localhost:${info.port}`);
});
