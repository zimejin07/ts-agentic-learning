/**
 * Plain (non-Ink) CLI: `pnpm start:plain "your goal"`.
 * Useful in CI, pipes, and terminals that are not a TTY.
 */
import { runPlainCli } from './plain.js';

runPlainCli().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
