import { AnthropicLlmClient } from './agent/anthropic-client.js';
import { runAgent } from './agent/loop.js';
import { tools } from './tools/index.js';
import type { TraceEvent } from './types/index.js';
import { getApiKey, getMaxIterations, getModel } from './utils/env.js';
import { log } from './utils/logger.js';

/**
 * CLI entry point: `pnpm start "your goal here"`.
 * Wires the real Anthropic client into the agent loop and prints each phase
 * of the run live as it happens.
 */
async function main(): Promise<void> {
  const goal = process.argv.slice(2).join(' ').trim();
  if (!goal) {
    console.error('Usage: pnpm start "<your goal>"');
    console.error('Example: pnpm start "What time is it, and what is 24 * 7?"');
    process.exit(1);
  }

  const model = getModel();
  const maxIterations = getMaxIterations();
  const client = new AnthropicLlmClient(getApiKey(), model);

  log.info(`Goal: ${goal}`);
  log.info(`Model: ${model} | Max iterations: ${maxIterations}\n`);

  const result = await runAgent({ goal, client, tools, maxIterations, onEvent: printEvent });

  console.log('\n--- Final answer ---');
  log.answer(result.answer);

  // Non-zero exit when we hit the cap, so scripts can detect incomplete runs.
  if (result.hitMaxIterations) {
    process.exitCode = 2;
  }
}

function printEvent(event: TraceEvent): void {
  switch (event.type) {
    case 'plan':
      log.plan(`\n${event.message}`);
      break;
    case 'act':
      log.act(event.message);
      break;
    case 'observe':
      log.observe(event.message);
      break;
    case 'reflect':
      log.reflect(event.message);
      break;
    case 'warning':
      log.warn(event.message);
      break;
    case 'answer':
      break; // printed once at the end, not inline
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
