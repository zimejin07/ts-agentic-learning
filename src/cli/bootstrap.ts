import type { TraceEvent } from '../types/index.js';
import { AnthropicLlmClient } from '../agent/anthropic-client.js';
import { getApiKey, getMaxIterations, getModel } from '../utils/env.js';

export interface CliConfig {
  goal: string;
  model: string;
  maxIterations: number;
  client: AnthropicLlmClient;
}

export function parseGoal(argv: string[]): string {
  return argv.slice(2).join(' ').trim();
}

export function printUsage(command: string): void {
  console.error(`Usage: ${command} "<your goal>"`);
  console.error('Example: pnpm start "What time is it, and what is 24 * 7?"');
}

export function loadCliConfig(): CliConfig {
  const model = getModel();
  const maxIterations = getMaxIterations();
  const client = new AnthropicLlmClient(getApiKey(), model);
  const goal = parseGoal(process.argv);
  return { goal, model, maxIterations, client };
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
