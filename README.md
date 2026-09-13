# core-typescript-node-fundamentals

A beginner-friendly **REST API + background worker** in TypeScript/Node.js.

- **API:** Hono + Zod + Drizzle on SQLite (todos CRUD)
- **Jobs:** Redis + BullMQ — the API is the producer, `pnpm worker` is the consumer

This is the `cursor/job-worker-6b4e` branch (extends `cursor/rest-api-6b4e`).

## What you learn

- HTTP routing with [Hono](https://hono.dev)
- Request validation with [Zod](https://zod.dev) (`@hono/zod-validator`)
- SQLite persistence via [Drizzle](https://orm.drizzle.team) + `better-sqlite3`
- SQL migrations checked into `drizzle/`
- Uniform JSON errors `{ error, requestId }`
- Testing the app with Hono's `app.request()` (no listening port)
- Background jobs: a `JobQueue` port, BullMQ in production, `MemoryQueue` in tests
- Idempotency keys so duplicate POSTs do not double-enqueue
- Retries with exponential backoff (mock webhook that fails on purpose)

## Setup

Node.js 20+ and [pnpm](https://pnpm.io). Redis is optional for unit tests.

```bash
pnpm install
cp .env.example .env
pnpm test
pnpm start                 # API (CRUD works without Redis)
```

With jobs (real Redis):

```bash
docker compose up -d redis
# set REDIS_URL=redis://127.0.0.1:6379 in .env
pnpm start                 # terminal 1 — producer
pnpm worker                # terminal 2 — consumer
```

The API listens on `http://localhost:3000` (override with `PORT`). SQLite lives at `data/app.db` by default (`DATABASE_PATH`).

## Endpoints

| Method | Path             | Body                         | Success                                  |
| ------ | ---------------- | ---------------------------- | ---------------------------------------- |
| GET    | `/health`        |                              | `{ "status": "ok" }`                     |
| GET    | `/todos`         |                              | `{ "todos": [...] }`                     |
| GET    | `/todos/:id`     |                              | `{ "todo": {...} }`                      |
| POST   | `/todos`         | `{ "title": "..." }`         | `201 { "todo", "jobId"? }`               |
| POST   | `/jobs/webhooks` | `{ "url", "failTimes"? }`    | `202 { "job": { id, name } }`            |
| GET    | `/jobs/:id`      |                              | `{ "job": { id, state, attemptsMade } }` |
| PATCH  | `/todos/:id`     | `{ "title"?, "completed"? }` | `{ "todo": {...} }`                      |
| DELETE | `/todos/:id`     |                              | `204`                                    |

Errors are `{ "error": "...", "requestId": "..." }` with `X-Request-Id` echoed. Validation failures are `400`; missing todos are `404`.

### curl

```bash
curl -s localhost:3000/health
curl -s -X POST localhost:3000/todos -H 'content-type: application/json' -H 'Idempotency-Key: create-1' -d '{"title":"Learn Hono"}'
curl -s -X POST localhost:3000/jobs/webhooks -H 'content-type: application/json' -d '{"url":"https://example.com/hook","failTimes":2}'
```

`failTimes` makes the mock webhook throw on the first N attempts so you can watch BullMQ retry in the worker logs.

Send `Idempotency-Key` on POST `/todos` or POST `/jobs/webhooks` to replay the original response instead of creating a second row/job.
curl -s localhost:3000/todos
curl -s -X PATCH localhost:3000/todos/<id> -H 'content-type: application/json' -d '{"completed":true}'
curl -s -X DELETE localhost:3000/todos/<id>

```

## How migrations work

`createDb()` runs every `drizzle/*.sql` file in order (`IF NOT EXISTS`). `pnpm db:migrate` does the same from the CLI.

## Project layout

```

src/
index.ts Node HTTP server
app.ts createApp({ db, queue })
jobs/ queue port, BullMQ adapter, MemoryQueue, processors
worker.ts BullMQ consumer process
docker-compose.yml Redis for local jobs
tests/todos.test.ts
tests/jobs.test.ts
db/schema.ts Drizzle table
db/client.ts SQLite open + migrate
todos/routes.ts Hono routes + Zod
todos/service.ts database access
middleware/ request-id, error envelope
drizzle/0000_init.sql
tests/todos.test.ts

```

## Assumptions

- Email and webhooks are **mocks** (no SMTP, no real HTTP). `failTimes` exists so retries are visible.
- Unit tests never start Redis; they use `MemoryQueue` and call `processJob` directly.
- No auth. This is a learning API, not a product.
- SQLite, not Postgres — zero ops for a laptop/CI. The Drizzle schema is the portable part.
- Titles are 1–200 characters; ids are UUIDs.

See [ARCHITECTURE.md](ARCHITECTURE.md) for design notes and what is not production-ready.
```
