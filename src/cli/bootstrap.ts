import type { TraceEvent } from '../types/index.js';
import { AnthropicLlmClient } from '../agent/anthropic-client.js';
import { getApiKey, getMaxIterations, getModel } from '../utils/env.js';
import { parseCliArgs } from './approve.js';

export interface CliConfig {
  goal: string;
  model: string;
  maxIterations: number;
  client: AnthropicLlmClient;
  autoApprove: boolean;
}

export function parseGoal(argv: string[]): string {
  return parseCliArgs(argv).goal;
}

export function printUsage(command: string): void {
  console.error(`Usage: ${command} [--yes] "<your goal>"`);
  console.error('  --yes  auto-approve side-effecting tools (book_flight)');
  console.error(
    'Example: pnpm start "Find a morning flight from SFO to JFK on 2026-09-15 under $400 and book it for Ada Lovelace."',
  );
}

export function loadCliConfig(): CliConfig {
  const model = getModel();
  const maxIterations = getMaxIterations();
  const client = new AnthropicLlmClient(getApiKey(), model);
  const { goal, autoApprove } = parseCliArgs(process.argv);
  return { goal, model, maxIterations, client, autoApprove };
}

export function printTraceEvent(
  event: TraceEvent,
  log: typeof import('../utils/logger.js').log,
): void {
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
    case 'approve':
      log.approve(event.message);
      break;
    case 'answer':
      break;
  }
}

export function attachAbort(): AbortController {
  const controller = new AbortController();
  const onSigint = () => {
    controller.abort();
  };
  process.once('SIGINT', onSigint);
  return controller;
}
