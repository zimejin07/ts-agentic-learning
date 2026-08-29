# core-typescript-node-fundamentals

A beginner-friendly **REST API** in TypeScript/Node.js: Hono + Zod validation + Drizzle ORM on SQLite. The domain is a tiny **todos** app — enough to learn routing, middleware, migrations, and error handling without a framework maze.

This is the `cursor/rest-api-6b4e` branch. A later branch (`cursor/job-worker-6b4e`) adds a Redis/BullMQ worker on top of this API.

## What you learn

- HTTP routing with [Hono](https://hono.dev)
- Request validation with [Zod](https://zod.dev) (`@hono/zod-validator`)
- SQLite persistence via [Drizzle](https://orm.drizzle.team) + `better-sqlite3`
- SQL migrations checked into `drizzle/`
- Uniform JSON errors `{ error, requestId }`
- Testing the app with Hono's `app.request()` (no listening port)

## Setup

Node.js 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
cp .env.example .env
pnpm test
pnpm start
```

The API listens on `http://localhost:3000` (override with `PORT`). SQLite lives at `data/app.db` by default (`DATABASE_PATH`).

## Endpoints

| Method | Path         | Body                         | Success                 |
| ------ | ------------ | ---------------------------- | ----------------------- |
| GET    | `/health`    |                              | `{ "status": "ok" }`    |
| GET    | `/todos`     |                              | `{ "todos": [...] }`    |
| GET    | `/todos/:id` |                              | `{ "todo": {...} }`     |
| POST   | `/todos`     | `{ "title": "..." }`         | `201 { "todo": {...} }` |
| PATCH  | `/todos/:id` | `{ "title"?, "completed"? }` | `{ "todo": {...} }`     |
| DELETE | `/todos/:id` |                              | `204`                   |

Errors are `{ "error": "...", "requestId": "..." }` with `X-Request-Id` echoed. Validation failures are `400`; missing todos are `404`.

### curl

```bash
curl -s localhost:3000/health
curl -s -X POST localhost:3000/todos -H 'content-type: application/json' -d '{"title":"Learn Hono"}'
curl -s localhost:3000/todos
curl -s -X PATCH localhost:3000/todos/<id> -H 'content-type: application/json' -d '{"completed":true}'
curl -s -X DELETE localhost:3000/todos/<id>
```

## How migrations work

`drizzle/0000_init.sql` is the source of truth. `createDb()` runs that file with `IF NOT EXISTS` on every boot, so a fresh clone just works. `pnpm db:migrate` does the same thing from the CLI.

To evolve the schema later: add a new numbered SQL file and apply it from `createDb()` (or switch to `drizzle-kit migrate`). This repo keeps the first migration hand-written so you can _read_ it.

## Project layout

```
src/
  index.ts                 Node HTTP server
  app.ts                   createApp(db) — used by tests and the server
  db/schema.ts             Drizzle table
  db/client.ts             SQLite open + migrate
  todos/routes.ts          Hono routes + Zod
  todos/service.ts         database access
  middleware/              request-id, error envelope
drizzle/0000_init.sql
tests/todos.test.ts
```

## Assumptions

- No auth. This is a learning API, not a product.
- SQLite, not Postgres — zero ops for a laptop/CI. The Drizzle schema is the portable part.
- Titles are 1–200 characters; ids are UUIDs.

See [ARCHITECTURE.md](ARCHITECTURE.md) for design notes and what is not production-ready.
