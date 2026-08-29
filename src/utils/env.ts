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
