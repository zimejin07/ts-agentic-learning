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
