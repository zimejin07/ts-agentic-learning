import dotenv from 'dotenv';

// Loads .env into process.env if present. The API key itself is ONLY ever
// read from the environment — it is never hardcoded or written to disk here.
dotenv.config();

export function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key, then try again.',
    );
  }
  return key;
}

export function getModel(): string {
  return process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
}

/**
 * The single most important safety valve of the whole project: without a hard
 * cap, a confused model could loop forever and burn tokens indefinitely.
 */
export function getMaxIterations(): number {
  const raw = process.env.AGENT_MAX_ITERATIONS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

/** Cumulative input+output token cap. Unset or 0 = unlimited. */
export function getTokenBudget(): number | undefined {
  const raw = process.env.AGENT_TOKEN_BUDGET;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** How many assistant/user pairs to keep. Default 6. 0 = never trim. */
export function getKeepLastTurns(): number {
  const raw = process.env.AGENT_KEEP_LAST_TURNS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 6;
}

/** Extra LLM attempts after a retryable error. Default 2 (3 tries total). */
export function getRetryAttempts(): number {
  const raw = process.env.AGENT_RETRY_ATTEMPTS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
}

export function getRetryDelayMs(): number {
  const raw = process.env.AGENT_RETRY_DELAY_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 200;
}
