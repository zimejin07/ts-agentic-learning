# How to learn from this repo

This is a **stacked curriculum** in one TypeScript CLI, not a product. Each layer is a lesson. Later layers reuse earlier ones; they do not replace them.

Read this file first. Then [README.md](README.md) for how to run it, then [ARCHITECTURE.md](ARCHITECTURE.md) for why the design looks this way.

```
Lesson 1  plan → act → observe → reflect
Lesson 2  live tokens (stream + Ink)
Lesson 3  loop as a control system (retry, budget, stuck calls, Zod, trim)
Lesson 4  a real workflow + human-in-the-loop (mock airline)
```

You need an Anthropic API key to **run** the CLI. You do **not** need one to **read the code** or `pnpm test` — tests drive the loop with a scripted fake LLM.

---

## Lesson 1 — The agent loop

**What to notice:** an agent is not “chat with extra steps.” It is a loop that can _do things_, see what happened, and decide again.

| Phase       | Who talks                                   | What you should see in the trace |
| ----------- | ------------------------------------------- | -------------------------------- |
| **plan**    | LLM, no tools                               | A JSON step list (advisory)      |
| **act**     | LLM asks; our code runs the tool            | `calculator({"expression":…})`   |
| **observe** | Tool result goes back as a user message     | `168` or `Error: …`              |
| **reflect** | Any text the model wrote with the tool call | Reasoning, not the answer        |
| **answer**  | LLM turn with **no** `tool_use`             | Final text                       |

**Try:**

```bash
pnpm start:plain "What time is it, and what is 24 * 7?"
```

**Read in this order:**

1. `src/types/index.ts` — the vocabulary (`LlmClient`, `ContentBlock`, `ToolDefinition`). The SDK is not here on purpose.
2. `src/tools/calculator.ts` — one tool. No `eval`. Errors return as strings.
3. `src/tools/index.ts` — `executeTool` never throws for tool failures.
4. `src/agent/loop.ts` — the while-loop.
5. `src/agent/prompts.ts` — planning prompt vs acting prompt (two jobs, two prompts).
6. `tests/loop.test.ts` — the same loop with a `FakeClient`. This is how you prove the loop without burning tokens.

**Ideas this lesson is teaching**

- Native `tool_use` beats parsing `TOOL: calculator ARGS: …` out of free text.
- History **is** memory. There is no second store the model can see.
- The model is the recovery mechanism: a bad tool call becomes an observation, not a crash.
- A hard `AGENT_MAX_ITERATIONS` cap is mandatory. Hoping the model stops is not a safety story.

---

## Lesson 2 — Streaming

**What to notice:** `complete()` waits for the whole message. `stream()` forwards `text_delta` so the CLI can render tokens as they arrive. Planning still uses `complete()` so the JSON plan is one parseable blob.

**Try:** `pnpm start "…"` on a TTY (Ink UI). `pnpm start:plain` still streams tokens to stdout. Pipes/CI fall back to the plain logger.

**Read:** `src/agent/stream-mapper.ts` (pure, unit-tested, no network), `src/agent/anthropic-client.ts` (`messages.stream()`), `src/cli/App.tsx` (50ms token flush — we do not re-render React on every character).

**Idea:** backpressure is two-sided. If Ink is slow, the `for await` pauses, which pauses reading the HTTP body.

---

## Lesson 3 — Loop engineering

Prompts can _ask_ the model not to repeat itself. The loop _enforces_ a few cheap invariants in `src/agent/loop-guards.ts`. Read that file in one sitting.

| Invariant              | Env / option              | What it prevents                                                            |
| ---------------------- | ------------------------- | --------------------------------------------------------------------------- |
| Retry 429 / 5xx only   | `AGENT_RETRY_*`           | Treating a 400 (our bug) as “try again”                                     |
| Token budget           | `AGENT_TOKEN_BUDGET`      | Unbounded spend next to the iteration cap                                   |
| Stuck-call fingerprint | (always on)               | `book_flight` with the same args after a decline                            |
| History trim           | `AGENT_KEEP_LAST_TURNS`   | Unbounded context. Drops **pairs**, never splits `tool_use` / `tool_result` |
| Zod at the registry    | `argsSchema` on each tool | `execute` seeing `{ expression: 42 }`                                       |

**Read:** `src/agent/loop-guards.ts`, then `tests/loop-engineering.test.ts` and `tests/loop-guards.test.ts`.

**Idea:** HTTP 400 is not retryable. Identical tool+args after a HITL decline is not re-executed — the fingerprint already recorded the first attempt.

---

## Lesson 4 — Workflow + human-in-the-loop

Lessons 1–3 are one-shot Q&A with tools. Booking is a **workflow**: the model must carry a `fare_id` across turns, quote before it books, and wait for a human on the only write.

```
search_flights (read) → get_fare (read, locks a quote) → book_flight (HITL write)
```

### Why airline, and why fake

A real GDS/payment API would bury the lesson. The catalog is in-memory, like mock `web_search`. The lesson is the **gate**, not aviation: read vs write, hidden state, decline as an observation.

### Seed catalog (why these six rows exist)

| `fare_id`               | Flight | Route   | Date       | Depart | USD | Teaching job                     |
| ----------------------- | ------ | ------- | ---------- | ------ | --- | -------------------------------- |
| `FARE-AA100-2026-09-15` | AA100  | SFO→JFK | 2026-09-15 | 07:15  | 329 | Morning + under $400             |
| `FARE-UA200-2026-09-15` | UA200  | SFO→JFK | 2026-09-15 | 09:40  | 389 | Second morning option under $400 |
| `FARE-DL300-2026-09-15` | DL300  | SFO→JFK | 2026-09-15 | 13:00  | 455 | Filtered out by `max_price: 400` |
| `FARE-AA400-2026-09-16` | AA400  | SFO→JFK | 2026-09-16 | 08:00  | 310 | Wrong date                       |
| `FARE-UA500-2026-09-15` | UA500  | LAX→JFK | 2026-09-15 | 06:30  | 275 | Wrong origin                     |
| `FARE-B6900-2026-09-15` | B6900  | SFO→BOS | 2026-09-15 | 07:00  | 198 | Wrong destination                |

Canonical demo goal:

> Find a morning flight from SFO to JFK on 2026-09-15 under $400 and book it for Ada Lovelace.

AA100 is the intended hit. The model _may_ pick UA200; both are valid under the cap.

### Registry pipeline (order matters)

This is the whole HITL lesson. It lives in `executeTool`, not in a special control plane.

```
unknown name?     → Error observation, no execute
Zod argsSchema    → Error observation, no HITL
preflight()       → domain errors (unknown fare, not quoted), no HITL
requiresApproval? → ask human (missing approver = deny)
execute()         → mock PNR, or catch crashes as Error strings
```

Invalid args never prompt. That is deliberate: the human is not a schema validator.

### What a booking trace looks like

Approve:

```
[plan]
1. Search SFO→JFK on 2026-09-15 under $400
2. Quote a fare
3. Book for Ada Lovelace
[act]     search_flights({"origin":"SFO","destination":"JFK","date":"2026-09-15","max_price":400})
[observe] FARE-AA100-2026-09-15 | AA100 | SFO→JFK | 2026-09-15 07:15–16:05 | $329
[act]     get_fare({"fare_id":"FARE-AA100-2026-09-15"})
[observe] Quoted FARE-AA100-2026-09-15
[act]     book_flight({"fare_id":"FARE-AA100-2026-09-15","passenger":"Ada Lovelace"})
[approve] Book AA100 SFO→JFK on 2026-09-15 07:15 for Ada Lovelace at $329
          (CLI waits for y/n — or pass --yes)
[observe] Booked. PNR-1001 | AA100 SFO→JFK 2026-09-15 | Ada Lovelace | USD 329
[answer]  Booked AA100 for Ada Lovelace. Confirmation PNR-1001.
```

Decline (`n`, or a pipe without `--yes`):

```
[approve] Book AA100 …
[warn]    User declined book_flight.
[observe] Error: user declined book_flight. Do not retry the same booking.
```

A second `book_flight` with the **same args** is blocked by the Lesson 3 fingerprint — HITL is not asked twice. The model should pick another fare or stop.

### How you approve

| Situation                      | What happens                                  |
| ------------------------------ | --------------------------------------------- |
| Ink TTY (`pnpm start`)         | Yellow box: `y` / `n`                         |
| Plain TTY (`pnpm start:plain`) | `[approve?] … [y/N]` on stdin                 |
| `--yes`                        | Auto-approve (demos / scripts)                |
| Pipe / CI, no `--yes`          | **Deny** (safe default — no silent bookings)  |
| Tests                          | Inject `onApprove: async () => true \| false` |
| `onApprove` omitted            | Deny                                          |

**Try:**

```bash
pnpm start "Find a morning flight from SFO to JFK on 2026-09-15 under $400 and book it for Ada Lovelace."
pnpm start --yes "Book the cheapest SFO to JFK on 2026-09-15 for Ada Lovelace."
```

**Read:** `src/tools/airline.ts`, HITL fields on `ToolDefinition` in `src/types/index.ts`, `src/cli/approve.ts`, Ink gate in `src/cli/App.tsx`, tests in `tests/airline.test.ts` and `tests/hitl-booking.test.ts`.

**Ideas this lesson is teaching**

- Read tools vs write tools.
- State the model must remember (`fare_id`) lives in **history**, while quotes/PNRs live in a tiny process store the model only sees via observations.
- The human is a **tool result**, not a separate orchestrator.
- Decline is recovery. Crash-on-deny would kill the learning (and the run).

---

## Tests as lessons

`pnpm test` needs no API key. Each file is a lesson checkpoint:

| File                             | Checkpoint                                              |
| -------------------------------- | ------------------------------------------------------- |
| `tests/loop.test.ts`             | Plan → act → observe → answer; unknown tool; max-iter   |
| `tests/stream-mapper.test.ts`    | SSE → `StreamEvent` without the network                 |
| `tests/loop-guards.test.ts`      | Fingerprint, trim, retry classification                 |
| `tests/loop-engineering.test.ts` | Those invariants wired through `runAgent`               |
| `tests/airline.test.ts`          | Catalog, quote-before-book, HITL never asked on garbage |
| `tests/hitl-booking.test.ts`     | Full workflow: approve, deny, unknown fare, no retry    |
| `tests/cli-args.test.ts`         | `--yes` is not part of the goal string                  |
| `tests/tools.test.ts`            | Calculator / time / mock search                         |
| `tests/parse-plan.test.ts`       | Lenient JSON plan parser                                |

---

## Suggested source reading order (whole repo)

```
src/types/index.ts          vocabulary + LlmClient seam
src/tools/calculator.ts     a pure tool
src/tools/index.ts          the gate (Zod → preflight → HITL → execute)
src/agent/loop.ts           the loop
src/agent/loop-guards.ts    control-system invariants
src/agent/prompts.ts        two prompts, two jobs
src/agent/stream-mapper.ts  streaming without the SDK
src/tools/airline.ts        the workflow
src/cli/approve.ts          HITL at the CLI
src/cli/App.tsx             live tokens + y/n
tests/hitl-booking.test.ts  the story in FakeClient form
```

---

## What this folder deliberately skips

Kept out so the repo stays a learning folder:

- Eval harness / LLM-as-judge (a separate PR exists; too large for this tree)
- Vector store / RAG
- Multi-agent orchestration
- Real airline, payments, email, GDS
- Node REST + job-queue fundamentals (other branches; not the agent loop)
- OTel, dollar cost, MCP, container sandbox, real `bash`/`fs`

Next lessons that would still fit this folder, if you want them later: prompt-injection via tool output, a Zod contract on the **final answer**, token-aware trim, compaction (summarize dropped turns), a second provider adapter on the `LlmClient` seam.
# How to master this agent — then take it to production

This repo is a **small, visible agent**, not a product. The point is to understand a handful of ideas well enough that you can re-implement them in a real system without copying the CLI.

Read in this order:

1. This file — concepts, what to run, how each idea extends.
2. [README.md](README.md) — setup and commands.
3. [ARCHITECTURE.md](ARCHITECTURE.md) — why the code is shaped this way, and where it would break.

You need an Anthropic API key to **run** the CLI. You do **not** need one to **read the code** or `pnpm test`. Tests drive the loop with a scripted fake LLM.

---

## The one sentence

An agent is a loop that can **call tools**, **see what happened**, and **decide again**, until it answers or a safety cap fires.

```
plan → (act → observe → reflect)* → answer
```

Chat without tools is not an agent. A hidden SDK `toolRunner` is an agent you cannot inspect. This project writes the loop by hand so every phase is a log line you can point at.

---

## Concept map

| Concept                      | What it is here                                  | File to read first                          | You have mastered it when…                                     |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------- |
| **Loop**                     | Plan, then tool turns until no `tool_use`        | `src/agent/loop.ts`                         | You can draw the message list after two tool calls from memory |
| **Native tools**             | API-constrained `tool_use` / `tool_result` pairs | `src/types/index.ts`, `src/tools/index.ts`  | You know why we never parse `TOOL: calc ARGS:` from free text  |
| **Error-as-observation**     | Tools never throw into the loop                  | `executeTool`                               | You can explain why a crash would be worse than `Error: …`     |
| **Untrusted input**          | Model-generated args; no `eval`                  | `src/tools/calculator.ts`                   | You treat every tool argument as hostile                       |
| **Provider seam**            | `LlmClient` is SDK-free                          | `src/types/index.ts`, `anthropic-client.ts` | You can describe how to add OpenAI without touching `loop.ts`  |
| **Fake LLM tests**           | Scripted `FakeClient`                            | `tests/loop.test.ts`                        | You can add a test for a new failure mode without a key        |
| **Advisory plan**            | Separate JSON call, not a state machine          | `planner.ts`, `parse-plan.ts`               | You know the acting model may skip steps                       |
| **Streaming + backpressure** | `text_delta` live; tool JSON buffered            | `stream-mapper.ts`, `App.tsx`               | You can explain both halves of backpressure                    |
| **Iteration cap**            | Mandatory `AGENT_MAX_ITERATIONS`                 | `loop.ts`, `env.ts`                         | You refuse to ship an agent with no hard stop                  |
| **Abort**                    | `AbortSignal` from Ctrl+C                        | `bootstrap.ts`                              | Cancel hits in-flight HTTP, not just the next iteration        |

---

## Part 1 — Master the loop

### 1. History is memory

The only state the **model** sees is `ChatMessage[]`. Each acting round:

1. Send full history + tool schemas.
2. Append the assistant turn **verbatim** (text and `tool_use` together).
3. If there are `tool_use` blocks, run them and append a user turn of matching `tool_result`s. The API requires that pairing; splitting it 400s the request.
4. If there are no tool calls, the text **is** the answer.

A parallel `trace` is for humans. The model never sees it. Do not confuse logs with memory.

**Prove it:** Read `tests/loop.test.ts`. The FakeClient never has a “memory”; it only has a queue. All continuity is in the messages `runAgent` accumulates.

### 2. Plan is a separate, tool-free call

Planning asks for `{"steps":[...]}` with no tools. Acting uses a different prompt and tools. Mixing both jobs in one prompt makes each worse.

The plan is **advisory**. It is pasted into the first user message. The model may skip or reorder steps. Enforcing a state machine (“only this step’s tools”) is a later production choice, not a beginner one.

If JSON fails, `parsePlan` degrades to a single-step plan. A broken plan must not crash the run.

**Prove it:** `tests/parse-plan.test.ts` and the fallback test in `tests/loop.test.ts`.

### 3. Native `tool_use`, not regex

Tools are declared with JSON Schema (`inputSchema`). The model returns structured blocks. That is more reliable than asking it to print a homemade DSL.

`executeTool`:

- Unknown name → `Error: unknown tool "X". Available: …`
- Thrown exception → `Error while running "X": …`
- Never throws those into `runAgent`

Each tool still validates its own args (this branch has no Zod at the registry). The calculator uses a hand-written parser **because `eval` on model input is a code-execution hole**.

**Prove it:** unknown-tool test in `tests/loop.test.ts`; `tests/tools.test.ts` for calculator/`eval` rejection.

### 4. Streaming is a second way to get the same `LlmResponse`

- `complete()` — blocking `messages.create`. Used for planning (one JSON blob).
- `stream()` — `messages.stream()`. Text deltas go to the CLI immediately. Tool-argument JSON is **buffered** until the block ends, then one `tool_use` is emitted. `message_complete` has the same shape as `complete()`.

If a client omits `stream()`, the loop falls back to `complete()`. That is why FakeClient tests did not need a stream implementation (a streaming FakeClient exists only to prove `onToken`).

**Backpressure has two sides:**

| Side     | What pauses                                         | Where                       |
| -------- | --------------------------------------------------- | --------------------------- |
| Provider | `for await` on the HTTP SSE                         | `AnthropicLlmClient.stream` |
| UI       | Token buffer flushed every ~50ms, not per character | `src/cli/App.tsx`           |

If you re-render React on every token, you stall the event loop and then the HTTP body. If you concatenate all deltas into an unbounded string in the assembler, you have a memory leak under a slow consumer.

**Prove it:** `tests/stream-mapper.test.ts`; streaming describe in `tests/loop.test.ts`.

### 5. Caps and cancel are not optional

- `AGENT_MAX_ITERATIONS` (default 8) is a hard stop. Hitting it returns a partial answer and CLI exit code 2.
- Ctrl+C sets `AbortSignal`. The loop checks between iterations; the SDK call gets the same signal.

There is **no** token budget on this branch. There is **no** retry on 429. Those are production extensions (Part 2), already sketched on later PRs in this GitHub repo.

**Try:**

```bash
pnpm start:plain "What time is it, and what is 24 * 7?"
pnpm start "What time is it, and what is 24 * 7?"   # TTY: live tokens
```

### Suggested reading order (this branch)

```
src/types/index.ts           vocabulary + LlmClient
src/tools/calculator.ts      a tool that does not trust its input
src/tools/index.ts           registry; never throw
src/agent/loop.ts            the loop
src/agent/planner.ts         plan + fallback
src/agent/prompts.ts         two jobs, two prompts
src/agent/stream-mapper.ts   SSE → StreamEvent (no SDK)
src/agent/anthropic-client.ts the only SDK import
src/cli/App.tsx              UI-side backpressure
tests/loop.test.ts           the loop without a network
```

### Tests as checkpoints

| File                          | What you are proving                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| `tests/loop.test.ts`          | Happy path, unknown tool, plan fallback, max-iter, stream vs complete |
| `tests/stream-mapper.test.ts` | Assembler without Anthropic                                           |
| `tests/tools.test.ts`         | Calculator safety, mock search, registry                              |
| `tests/parse-plan.test.ts`    | Lenient JSON, fences, garbage                                         |

---

## Part 2 — Extend each concept to production

Do not “add a framework.” Re-implement the **same ideas** with production constraints. Keep the seam; replace the toys.

### Keep (these ideas survive)

- A hand-written or at least **inspectable** loop. Hidden runners are fine later; you should be able to log plan/act/observe yourself first.
- Native tool calling (`tool_use` / function calling), not a text DSL.
- Errors as observations for **model-recoverable** failures.
- A provider interface so tests do not hit the network.
- A hard stop (iterations **and** tokens **and** wall clock).
- Abort that actually cancels HTTP.
- Streaming with backpressure if humans are watching the tokens.

### Change (this demo is too small)

| Demo behavior               | Production version                                                        |
| --------------------------- | ------------------------------------------------------------------------- |
| History is unbounded RAM    | Trim or compact; never split `tool_use`/`tool_result`; persist sessions   |
| Tool args validated ad hoc  | One registry gate (Zod/JSON Schema) **before** `execute`                  |
| Three pure in-process tools | Side-effecting tools behind HITL + sandbox + timeouts                     |
| Sequential tools            | Parallelize independent calls; still serialize anything that shares state |
| Fake `web_search`           | Real HTTP with allowlists, size limits, untrusted-observation handling    |
| Console trace               | Structured logs + traces (request id, tool name, tokens, latency, cost)   |
| Single process CLI          | HTTP/queue worker, idempotency keys, multi-tenant isolation               |
| Advisory plan only          | Optional: enforce step/tool allowlists for high-risk workflows            |
| No retry                    | Retry **429/5xx only**; never retry 400 (that is your bug)                |
| Ignore `usage`              | Accumulate input+output tokens; dollar budget; per-tenant quotas          |

### Add (not in this branch)

These are the usual next layers. Later PRs in **this same GitHub repo** already sketch some of them — read those diffs after you understand this branch.

| Layer                                   | Why production needs it                                  | Starting point in _this_ code                                                   |
| --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Zod (or equivalent) at the registry** | Model JSON is untrusted; do not make every tool re-parse | `executeTool` before `tool.execute`                                             |
| **Stuck-call fingerprint**              | Models retry the same failing call                       | Set of `name + canonical JSON args` in `loop.ts`                                |
| **Token budget**                        | Iteration cap does not bound spend                       | Map provider `usage` into `LlmResponse`; stop like max-iter                     |
| **Retry/backoff**                       | 429s are normal                                          | Wrap `complete`/`stream` only; abort is not retryable                           |
| **HITL**                                | Writes (book, email, pay, delete) must not be silent     | `requiresApproval` on `ToolDefinition`; human result is an observation          |
| **Workflow state**                      | Booking/quotes/PNR cannot live only in prose             | Tool-side store **plus** ids in history (see HITL booking PR)                   |
| **Answer contract**                     | “The model stopped talking” ≠ “we have a valid result”   | Zod on the final answer, or a structured `tool` that submits the result         |
| **Prompt injection**                    | Tool output can say “ignore the goal”                    | Treat observations as untrusted; delimit; never concatenate into system blindly |
| **Sandbox**                             | `bash` / `fs` / browser in-process is RCE                | Subprocess, container, or WASM; least privilege                                 |
| **Timeouts**                            | Hung tools stall the loop                                | `AbortSignal` per tool + error observation                                      |
| **Idempotency**                         | Retries must not double-charge                           | Idempotency key on writes (see job-worker PR for the Node pattern)              |
| **Eval**                                | Refactors will silently change behavior                  | Golden traces with FakeClient first; live eval later, not in CI                 |
| **Second provider**                     | Vendor lock-in and failover                              | New class implementing `LlmClient`; loop unchanged                              |
| **OTel**                                | You cannot debug what you cannot see                     | Span per LLM call, per tool; attributes: model, tokens, tool name               |

### A concrete production skeleton (same loop)

When you leave this folder, a production agent still looks like:

```
API/queue request
  → load session history (DB)
  → runAgent({ client, tools, caps, onApprove, onEvent: metrics })
  → persist new messages + usage
  → return answer + trace id
```

`runAgent` can stay a pure-ish function. Production wraps it with:

1. Auth and tenancy
2. Durable history
3. Caps (iter, tokens, time, money)
4. Approval channel (Slack, UI, `--yes` equivalent for jobs)
5. Observability
6. A tool registry that knows read vs write

You do **not** need multi-agent orchestration first. One well-capped loop with HITL on writes beats five agents with no budget.

### Mapping this CLI to an HTTP service

| CLI piece               | HTTP/worker analogue                             |
| ----------------------- | ------------------------------------------------ |
| `pnpm start "goal"`     | `POST /runs` with `{ goal, sessionId }`          |
| Ink / stdout trace      | SSE or websocket of `TraceEvent`; store the rest |
| Ctrl+C `AbortSignal`    | Request abort, job cancel, deadline              |
| `--yes` (later HITL PR) | Trusted worker path or already-approved policy   |
| `.env` API key          | Secret manager; never in the repo                |
| FakeClient tests        | Same tests in CI; no live model on PR            |

### Security checklist before a real tool

Copy this. The demo is safe only because tools are pure.

- [ ] Args parsed with a schema at the registry, not only inside `execute`
- [ ] No `eval`, no shell with unsanitized strings, no unbounded HTTP
- [ ] Writes require HITL or a signed policy
- [ ] Tool timeout + cancel
- [ ] Output size limit (model context and logs)
- [ ] Observations treated as data, not instructions
- [ ] Secrets never in prompts, traces, or tool args logs
- [ ] Sandbox before filesystem/network/shell

### What not to copy blindly

- **Ink** — learning UI. Production UIs subscribe to events; they do not own the loop.
- **In-process tools with Node privileges** — fine for `calculator`; fatal for `bash`.
- **“The model will stop”** — it will not. Caps are mandatory.
- **Retrying every error** — retrying HTTP 400 duplicates a bad request and burns money.
- **LLM-as-judge in CI** — flaky. FakeClient golden traces first.
- **Vector memory as step one** — persist messages and ids first; RAG is a different product.

---

## Later lessons in this GitHub repo (optional)

This branch stops at **loop + streaming**. Other PRs stack more of Part 2 without turning this folder into a platform:

| PR                                                            | Branch                                | What it adds                                                                          |
| ------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| [#4](https://github.com/zimejin07/ts-agentic-learning/pull/4) | `cursor/loop-engineering-6b4e`        | Retry 429/5xx, token budget, stuck-call fingerprint, history trim, Zod before execute |
| [#5](https://github.com/zimejin07/ts-agentic-learning/pull/5) | `cursor/hitl-booking-6b4e`            | Mock airline workflow + human approval on `book_flight`                               |
| [#2](https://github.com/zimejin07/ts-agentic-learning/pull/2) | `cursor/eval-harness-6b4e`            | Deterministic FakeClient eval (larger than this learning folder needs)                |
| [#3](https://github.com/zimejin07/ts-agentic-learning/pull/3) | `cursor/fundamentals-job-worker-6b4e` | Node jobs/idempotency — useful, not the agent loop                                    |

Read those **after** you can explain this branch’s concept map without looking.

---

## You are done with this folder when you can

1. Sketch plan/act/observe/reflect and where `tool_use` must be answered by `tool_result`.
2. Add a fourth tool (read-only) in the registry without touching the loop.
3. Write a FakeClient test for “model calls a tool that throws.”
4. Explain why streaming buffers tool JSON but not text.
5. List the production wrap: caps, schema gate, HITL on writes, persist history, observe tokens, sandbox side effects.
6. Implement a second `LlmClient` adapter in your head (request in, `LlmResponse` out).

Then stop polishing this CLI and build the production skeleton above in the app that actually needs an agent.
