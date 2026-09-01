import readline from 'node:readline';
import type { ApprovalRequest } from '../types/index.js';

export interface ParsedCliArgs {
  goal: string;
  autoApprove: boolean;
}

/** Pull `--yes` out of argv so it is never treated as part of the goal. */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const rest = argv.slice(2);
  const autoApprove = rest.includes('--yes');
  const goal = rest
    .filter((arg) => arg !== '--yes')
    .join(' ')
    .trim();
  return { goal, autoApprove };
}

export async function promptYesNo(question: string, abortSignal?: AbortSignal): Promise<boolean> {
  if (abortSignal?.aborted) {
    throw new Error('Aborted');
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const line = await new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        rl.close();
        reject(new Error('Aborted'));
      };
      abortSignal?.addEventListener('abort', onAbort, { once: true });
      rl.question(`${question} [y/N] `, (answer) => {
        abortSignal?.removeEventListener('abort', onAbort);
        resolve(answer);
      });
    });
    return /^(y|yes)$/i.test(line.trim());
  } finally {
    rl.close();
  }
}

export function createStdinApprover(options: {
  autoApprove: boolean;
  abortSignal?: AbortSignal;
}): (request: ApprovalRequest) => Promise<boolean> {
  return async (request) => {
    if (options.autoApprove) return true;
    return promptYesNo(`[approve?] ${request.summary}`, options.abortSignal);
  };
}
