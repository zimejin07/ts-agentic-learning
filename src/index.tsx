/**
 * CLI entry point: `pnpm start "your goal here"`.
 *
 * On a TTY we render the Ink UI so tokens appear live. In pipes / CI we fall
 * back to the plain logger (same as `pnpm start:plain`).
 */
import React from 'react';
import { render } from 'ink';
import { App } from './cli/App.js';
import { attachAbort, loadCliConfig, parseGoal, printUsage } from './cli/bootstrap.js';
import { runPlainCli } from './cli/plain.js';

async function main(): Promise<void> {
  const goal = parseGoal(process.argv);
  if (!goal) {
    printUsage('pnpm start');
    process.exit(1);
  }

  if (!process.stdout.isTTY) {
    await runPlainCli();
    return;
  }

  const { model, maxIterations, client, autoApprove } = loadCliConfig();
  const abort = attachAbort();

  const instance = render(
    <App
      goal={goal}
      model={model}
      maxIterations={maxIterations}
      client={client}
      abortSignal={abort.signal}
      autoApprove={autoApprove}
    />,
  );

  await instance.waitUntilExit();
  if (abort.signal.aborted) {
    process.exitCode = 130;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
