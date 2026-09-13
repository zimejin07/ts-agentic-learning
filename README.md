# ts-agentic-learning

A small, beginner-friendly **agentic AI** project in TypeScript/Node.js. It takes a goal in plain English, plans how to solve it, calls tools, observes the results, reflects, and loops until it has an answer — printing every phase to the console so you can watch the agent think.

The point of this repo is **learning the core agentic pattern**, not building a product:

```
plan -> act -> observe -> reflect -> (loop) -> answer
```

**How to read this repo**

1. [LEARNING.md](LEARNING.md) — stacked lessons (loop → streaming → loop engineering → HITL booking), what to run, what to notice.
2. This README — setup, commands, tools, layout.
1. [LEARNING.md](LEARNING.md) — master each concept, then map it to production (keep / change / add).
2. This README — setup, commands, layout, adding a tool.
3. [ARCHITECTURE.md](ARCHITECTURE.md) — design decisions and failure modes.

You need an Anthropic API key to run the CLI. `pnpm test` does not: the loop is driven by a fake LLM.

## What it does

1. Takes a user goal as text input from the CLI.
2. Asks the LLM to break the goal into a short plan (a JSON step list).
3. Loops: the LLM decides which tool to call, the tool runs, the output goes back to the LLM as an observation.
4. Stops when the LLM produces a final answer, or when a max-iteration / token-budget cap is hit.
5. Prints the full trace (`[plan]`, `[act]`, `[observe]`, `[reflect]`, `[approve]`, `[answer]`) plus the final answer.

### Built-in tools

| Tool             | HITL?   | What it does                                                          |
| ---------------- | ------- | --------------------------------------------------------------------- |
| `calculator`     | no      | Safe arithmetic (`+ - * /`, parentheses, decimals). No `eval`.        |
| `current_time`   | no      | Current date/time, optionally in an IANA timezone.                    |
| `web_search`     | no      | A **mock** search backed by a tiny built-in index (not the real web). |
| `search_flights` | no      | Mock airline search. Returns `fare_id` lines (no network).            |
| `get_fare`       | no      | Locks a quote for a `fare_id`. Required before booking.               |
| `book_flight`    | **yes** | Issues a mock PNR. Pauses for `y/n` (or `--yes`) before execute.      |

## Setup

Requirements: Node.js 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
cp .env.example .env   # then put your Anthropic API key in .env
```

Your key is read from the `ANTHROPIC_API_KEY` environment variable only — it is never hardcoded, and `.env` is gitignored.

Optional environment variables (see `.env.example`):

- `ANTHROPIC_MODEL` — defaults to `claude-sonnet-4-5`
- `AGENT_MAX_ITERATIONS` — defaults to `8`
- `AGENT_TOKEN_BUDGET` — cumulative input+output tokens; `0` / unset = unlimited
- `AGENT_KEEP_LAST_TURNS` — history window (default `6` pairs). `0` = never trim
- `AGENT_RETRY_ATTEMPTS` / `AGENT_RETRY_DELAY_MS` — 429/5xx retries (default 2 extra tries, 200ms)

`--yes` is a **CLI flag**, not an env var: auto-approve `book_flight`. Without it, a TTY asks `y/n` and a pipe declines.

## Run it

```bash
# Live Ink UI — tokens stream in as they arrive (requires a TTY)
pnpm start "What time is it, and what is 24 * 7?"

# Plain console logger (pipes, CI, or if you prefer the original output)
pnpm start:plain "What time is it, and what is 24 * 7?"

# Mock airline workflow: search → quote → human approval → PNR
pnpm start "Find a morning flight from SFO to JFK on 2026-09-15 under $400 and book it for Ada Lovelace."

# Skip the y/n prompt (demos / scripts)
pnpm start --yes "Book the cheapest SFO to JFK on 2026-09-15 for Ada Lovelace."
```

`pnpm start` falls back to the plain logger automatically when stdout is not a TTY. Press **Ctrl+C** to abort an in-flight request. Piped stdin without `--yes` **declines** `book_flight` (safe default).

### Example: calculator / time

```
[plan]
1. Get the current time
2. Compute 24 * 7
[act]     current_time({})
[observe] ISO: 2026-08-29T12:00:00.000Z | Local: Saturday, August 29, 2026 at ...
[act]     calculator({"expression":"24 * 7"})
[observe] 168
[reflect] I have both pieces of information now.
--- Final answer ---
[answer]  It is currently ... and 24 * 7 = 168.
```

### Example: airline booking (HITL)

The catalog is fake. AA100 ($329, 07:15 SFO→JFK on 2026-09-15) is the intended hit for the demo goal. Full table and decline path: [LEARNING.md](LEARNING.md).

```
[plan]
1. Search SFO→JFK on 2026-09-15 under $400
2. Quote a fare
3. Book for Ada Lovelace
[act]     search_flights({"origin":"SFO","destination":"JFK","date":"2026-09-15","max_price":400})
[observe] FARE-AA100-2026-09-15 | AA100 | SFO→JFK | 2026-09-15 07:15–16:05 | $329
          …
[act]     get_fare({"fare_id":"FARE-AA100-2026-09-15"})
[observe] Quoted FARE-AA100-2026-09-15
[act]     book_flight({"fare_id":"FARE-AA100-2026-09-15","passenger":"Ada Lovelace"})
[approve] Book AA100 SFO→JFK on 2026-09-15 07:15 for Ada Lovelace at $329
          ← type y or n (or pass --yes)
[observe] Booked. PNR-1001 | AA100 SFO→JFK 2026-09-15 | Ada Lovelace | USD 329
--- Final answer ---
[answer]  Booked AA100 for Ada Lovelace. Confirmation PNR-1001.
```

On `n`, the observation is `Error: user declined book_flight. Do not retry the same booking.` Retrying the same args is blocked by the stuck-call fingerprint.

## How the agent loop works

```
        ┌─────────────┐
 goal ─►│    PLAN     │  one LLM call, no tools, returns JSON steps
        └──────┬──────┘
               ▼
        ┌─────────────┐    tool_use     ┌──────────────┐
        │  LLM turn   │───────────────► │  ACT: run    │
        │ (with tools)│                 │  the tool    │
        └──────┬──────┘                 └──────┬───────┘
               │                               ▼
               │                        ┌──────────────┐
               │                        │ OBSERVE:     │
               │                        │ tool_result  │
               │                        │ appended to  │
               │                        │ history      │
               │                        └──────┬───────┘
               │                               ▼
               │                        ┌──────────────┐
               │                        │ REFLECT:     │
               │◄────────────────────── │ model's text │
               │        next iteration  │ this turn    │
               ▼                        └──────────────┘
        end_turn (no tool calls)
               ▼
        final ANSWER + full trace
```

- **Plan** — a separate LLM call (no tools) produces `{"steps":[...]}`. If it can't be parsed, we fall back to a single-step plan and keep going.
- **Act** — the LLM requests a tool via Anthropic's native `tool_use`; the registry looks it up and runs it.
- **Observe** — the tool's output (or error string) is appended to the conversation as a `tool_result`.
- **Reflect** — any text the model writes alongside tool calls is logged as its reasoning.
- **Loop** — repeats until the model answers without calling tools, or `AGENT_MAX_ITERATIONS` is reached.
- **HITL** — tools marked `requiresApproval` (today: `book_flight`) pause after Zod/preflight. The human's yes/no comes back as a normal observation, not a special control plane. Invalid args never prompt.

The conversation history **is** the agent's memory — there is no other state store the model can see. Airline quotes/PNRs live in a tiny process table; the model only learns about them through observations. See [LEARNING.md](LEARNING.md) for the curriculum and [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions.
The conversation history **is** the agent's memory — there is no other state store. See [LEARNING.md](LEARNING.md) to master that idea and [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions.

## Project layout

```
src/
  index.tsx              CLI entry (Ink UI on a TTY)
  cli/
    App.tsx              Ink layout: live tokens, plan, rolling trace, y/n gate
    plain.ts             plain logger runner
    plain-entry.ts       `pnpm start:plain`
    bootstrap.ts         shared argv / env / abort wiring
    approve.ts           `--yes` parsing and stdin y/n
  agent/
    loop.ts              the plan-act-observe-reflect loop
    loop-guards.ts       retry, token budget helpers, stuck-call fingerprint, history trim
    planner.ts           planning call + fallback
    prompts.ts           system prompts
    anthropic-client.ts  the only file that imports the Anthropic SDK
    stream-mapper.ts     SSE events -> StreamEvent (unit-tested, no network)
  tools/
    index.ts             registry + safe executeTool()
    calculator.ts
    current-time.ts
    web-search.ts        (mock)
    airline.ts           mock search / quote / book (HITL on book)
  types/index.ts         shared, SDK-free types (incl. the LlmClient seam)
  utils/
    env.ts               env loading (API key, model, max iterations)
    logger.ts            colored per-phase console output
    parse-plan.ts        lenient JSON plan parser
tests/                   vitest: tools, plan parsing, loop, loop-guards, HITL booking (fake LLM)
LEARNING.md              curriculum: what each layer teaches
tests/                   vitest: tools, plan parsing, loop, stream mapper (fake LLM)
LEARNING.md              concepts → production mapping
ARCHITECTURE.md          design decisions and failure modes
```

## How to add a new tool

1. Create `src/tools/my-tool.ts` and export a `ToolDefinition`:

```ts
import { z } from 'zod';
import type { ToolDefinition } from '../types/index.js';

export const myTool: ToolDefinition = {
  name: 'my_tool',
  description: 'Describe what it does so the model knows when to use it.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What each argument means.' },
    },
    required: ['query'],
  },
  argsSchema: z.object({ query: z.string().min(1) }),
  execute: (input) => {
    return `You searched for: ${input.query}`;
  },
};
```

2. Register it in `src/tools/index.ts` by adding it to the `tools` array.

That's it — the loop, the prompts, and the Anthropic tool schema pick it up automatically. Rules of thumb: never throw from `execute` (return `Error: ...` strings), and never use `eval`. For a side-effecting tool, set `requiresApproval: true` and optionally `preflight` (domain errors skip the prompt) plus `approvalSummary`.
That's it — the loop, the prompts, and the Anthropic tool schema pick it up automatically. Rules of thumb: never throw from `execute` (return `Error: ...` strings), never use `eval`, and treat every argument as untrusted model output.

In production you would also: schema-validate at the **registry** (not only inside the tool), mark writes as needing human approval, and run anything that touches disk/network/shell in a sandbox. That mapping is in [LEARNING.md](LEARNING.md).

## Tests and checks

```bash
pnpm test        # vitest (no API key — FakeClient scripts the LLM)
pnpm lint        # eslint
pnpm typecheck   # tsc --noEmit
pnpm format      # prettier
```

Which test file maps to which lesson is in [LEARNING.md](LEARNING.md).

## Assumptions

- `web_search` and the airline catalog are intentionally fake: deterministic, free, and safe for tests. No real tickets, payments, or web search.
- `book_flight` is the only irreversible step. Search and quote are free; the human is the payment rail.
What each test file is proving: [LEARNING.md](LEARNING.md) (tests as checkpoints).

## Assumptions

- `web_search` is intentionally fake: deterministic, free, and safe for tests. Swapping in a real search API only means rewriting its `execute` — plus allowlists, timeouts, and treating the snippet as **untrusted** text.
- The plan is **advisory**: the acting loop sees it but may skip or reorder steps.
- This is a learning demo, not production software. [LEARNING.md](LEARNING.md) Part 2 is the production extension map; [ARCHITECTURE.md](ARCHITECTURE.md) lists what this branch does not do.
