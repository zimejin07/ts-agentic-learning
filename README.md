# ts-agentic-learning

A small, beginner-friendly **agentic AI** project in TypeScript/Node.js. It takes a goal in plain English, plans how to solve it, calls tools, observes the results, reflects, and loops until it has an answer — printing every phase to the console so you can watch the agent think.

The point of this repo is **learning the core agentic pattern**, not building a product:

```
plan -> act -> observe -> reflect -> (loop) -> answer
```

## What it does

1. Takes a user goal as text input from the CLI.
2. Asks the LLM to break the goal into a short plan (a JSON step list).
3. Loops: the LLM decides which tool to call, the tool runs, the output goes back to the LLM as an observation.
4. Stops when the LLM produces a final answer, or when a max-iteration safety cap is hit.
5. Prints the full trace (`[plan]`, `[act]`, `[observe]`, `[reflect]`, `[answer]`) plus the final answer.

### Built-in tools

| Tool           | What it does                                                          |
| -------------- | --------------------------------------------------------------------- |
| `calculator`   | Safe arithmetic (`+ - * /`, parentheses, decimals). No `eval`.        |
| `current_time` | Current date/time, optionally in an IANA timezone.                    |
| `web_search`   | A **mock** search backed by a tiny built-in index (not the real web). |

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

## Run it

```bash
pnpm start "What time is it, and what is 24 * 7?"
```

Example output (abridged):

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

The conversation history **is** the agent's memory — there is no other state store. See [ARCHITECTURE.md](ARCHITECTURE.md) for the design decisions and failure-mode analysis.

## Project layout

```
src/
  index.ts               CLI entry point
  agent/
    loop.ts              the plan-act-observe-reflect loop
    planner.ts           planning call + fallback
    prompts.ts           system prompts
    anthropic-client.ts  the only file that imports the Anthropic SDK
  tools/
    index.ts             registry + safe executeTool()
    calculator.ts
    current-time.ts
    web-search.ts        (mock)
  types/index.ts         shared, SDK-free types (incl. the LlmClient seam)
  utils/
    env.ts               env loading (API key, model, max iterations)
    logger.ts            colored per-phase console output
    parse-plan.ts        lenient JSON plan parser
tests/                   vitest: tools, plan parsing, the loop, and eval graders
eval/                    scenario runner for agent-behavior regression (fake LLM)
```

## How to add a new tool

1. Create `src/tools/my-tool.ts` and export a `ToolDefinition`:

```ts
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
  execute: (input) => {
    // Validate input yourself — it comes from the model.
    if (typeof input.query !== 'string') return 'Error: "query" must be a string.';
    return `You searched for: ${input.query}`;
  },
};
```

2. Register it in `src/tools/index.ts` by adding it to the `tools` array.

That's it — the loop, the prompts, and the Anthropic tool schema pick it up automatically. Rules of thumb: never throw from `execute` (return `Error: ...` strings), and never use `eval`.

## Tests and checks

```bash
pnpm test        # vitest (no API key needed — the loop is tested with a fake LLM)
pnpm eval        # scenario runner against a fake LLM (also no API key)
pnpm lint        # eslint
pnpm typecheck   # tsc --noEmit
pnpm format      # prettier
```

GitHub Actions runs `pnpm test` and `pnpm eval` on every push/PR. There is no API key in CI.

## Eval harness

`eval/` is a tiny regression suite for _agent behavior_, not answer quality:

| Piece                   | Role                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `eval/scenarios/*.json` | goal + scripted LLM replies + graders                                |
| `eval/fake-client.ts`   | pops canned `LlmResponse`s (same idea as unit tests)                 |
| `eval/graders.ts`       | `answerContains`, `toolsCalled`, `hitMaxIterations`, `planStepCount` |
| `eval/runner.ts`        | loads scenarios, runs `runAgent`, exits 1 on any failure             |

This is **not** an LLM-as-judge. Live-model eval (`EVAL_LIVE=1`) is intentionally unsupported — it would be non-deterministic and does not belong in CI.

### How to add a scenario

1. Copy `eval/scenarios/calculator-24-7.json`.
2. Fill in `scriptedResponses` in the same order the agent will call the LLM (plan, then acting turns).
3. Set `expect` checks. Keep them mechanical (substrings, tool names, flags).
4. Run `pnpm eval`.

## Assumptions

- `web_search` is intentionally fake: deterministic, free, and safe for tests. Swapping in a real search API only means rewriting its `execute`.
- The plan is **advisory**: the acting loop sees it but may skip or reorder steps.
- This is a learning demo, not production software — see the "not production-ready" section of [ARCHITECTURE.md](ARCHITECTURE.md).
