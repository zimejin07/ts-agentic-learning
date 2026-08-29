import { runAgent } from '../agent/loop.js';
import { tools } from '../tools/index.js';
import { log } from '../utils/logger.js';
import { attachAbort, loadCliConfig, parseGoal, printTraceEvent, printUsage } from './bootstrap.js';

export async function runPlainCli(): Promise<void> {
  const goal = parseGoal(process.argv);
  if (!goal) {
    printUsage('pnpm start:plain');
    process.exit(1);
  }

  const { model, maxIterations, client } = loadCliConfig();
  const abort = attachAbort();

  log.info(`Goal: ${goal}`);
  log.info(`Model: ${model} | Max iterations: ${maxIterations}\n`);

  try {
    const result = await runAgent({
      goal,
      client,
      tools,
      maxIterations,
      abortSignal: abort.signal,
      onEvent: (event) => printTraceEvent(event, log),
      onToken: (text) => process.stdout.write(text),
    });

    console.log('\n\n--- Final answer ---');
    log.answer(result.answer);

    if (result.hitMaxIterations) {
      process.exitCode = 2;
    }
  } catch (error: unknown) {
    if (abort.signal.aborted || (error instanceof Error && error.message === 'Aborted')) {
      console.error('\nAborted.');
      process.exitCode = 130;
      return;
    }
    throw error;
  }
}
