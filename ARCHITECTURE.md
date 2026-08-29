# Architecture

Learning notes for the todos API: why these libraries, how a request flows, and what we deliberately left out.

## Request flow

```mermaid
flowchart LR
  req[HTTP request] --> rid[requestId middleware]
  rid --> z[Zod validator]
  z -->|400| err[error envelope]
  z --> route[Hono route]
  route --> svc[todos service]
  svc --> db[Drizzle SQLite]
  db --> json[JSON response]
```

1. `requestId` stamps every request (`X-Request-Id` in, UUID if missing) so logs and error bodies correlate.
2. `zValidator` parses params/body. Invalid input never reaches the service — that is the whole point of a schema at the edge.
3. The service talks to Drizzle. `404` is thrown as `HTTPException`; `onError` turns every failure into `{ error, requestId }`.

`createApp({ db, queue })` is a factory. Tests pass `:memory:` SQLite and a `MemoryQueue`; the server passes a file-backed db and BullMQ when `REDIS_URL` is set.

## Jobs: producer / consumer

```mermaid
flowchart LR
  api[POST todos or webhooks] --> idemp[Idempotency-Key SQLite]
  idemp --> queue[JobQueue port]
  queue --> redis[Redis BullMQ]
  redis --> worker[pnpm worker]
  worker --> proc[processJob mock email or webhook]
```

The API never runs the slow work itself. It records an intent (`send_email`, `webhook_retry`) and returns. The worker pulls jobs, retries on throw (3 attempts, exponential backoff), and logs JSON `{ jobId, attempt, durationMs }`.

Tests inject `MemoryQueue` so CI does not need Redis. Processors are unit-tested by calling `processJob` with `failTimes`.

**Why idempotency:** a client retry of POST would otherwise create a second todo and a second email job. The key is stored with method+path so reusing a key on a different route is a 409.

## Design decisions

- **Hono over Express** — small, TypeScript-first, `app.request()` for tests without `supertest` or a listening port.
- **Zod at the HTTP boundary, not in the database layer** — the service trusts its typed arguments. One schema per endpoint keeps error messages close to the wire format.
- **Drizzle + SQL file** — the ORM gives typed queries; the `.sql` file is readable without generating a mystery snapshot. `IF NOT EXISTS` makes boot idempotent for a learning project (a real app would use a migrations journal).
- **SQLite** — no Docker required for the API itself. WAL mode is on for slightly saner concurrent reads.
- **UUIDs as text PKs** — no autoincrement surprises when we later enqueue jobs keyed by todo id.

## Failure modes

| Failure                 | Handling                                             |
| ----------------------- | ---------------------------------------------------- |
| Invalid JSON / Zod fail | 400 + `{ error, requestId }`                         |
| Unknown todo id         | 404                                                  |
| Non-UUID `:id`          | 400 (param schema)                                   |
| Unexpected throw        | 500, stack logged with requestId                     |
| Missing data directory  | `src/index.ts` creates `data/` before opening SQLite |

## What's missing / not production-ready

- No authentication or authorization
- No pagination, filtering, or optimistic concurrency
- No Postgres / connection pooling
- No structured request logs (method, path, duration)
- No OpenAPI spec
- No rate limiting
- SQLite file is a single point of failure; not for multi-instance deploys
- Migration strategy is "run the SQL on boot", not a versioned migrator with down migrations
- No auth on job endpoints; mock email/webhooks only
- Single BullMQ queue (`default`); no dead-letter dashboard
- Idempotency keys never expire
- Worker has no graceful drain/timeout beyond process signals

## If I were to productionize this

- Move to Postgres + `drizzle-kit migrate` with a migrations table
- Add auth (session or JWT) and per-user todos
- Emit JSON logs and an OpenTelemetry trace per request **and per job**
- Publish OpenAPI from the Zod schemas
- Add pagination and `If-Match` / `updated_at` for safe PATCH
- TTL idempotency keys; a real DLQ UI; multiple queues by priority
- Sandbox or allowlist webhook URLs (SSRF)
