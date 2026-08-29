import type { Plan } from '../types/index.js';

/**
 * Extracts a Plan from raw LLM text.
 *
 * The planner prompt asks for pure JSON, but models sometimes wrap it in
 * ```json fences or add chatter around it. Rather than trusting the format
 * (a classic agent failure mode), we try several extraction strategies and
 * validate the shape. Returns null when nothing usable is found — the caller
 * decides on a fallback, this function never throws.
 */
export function parsePlan(raw: string): Plan | null {
  for (const candidate of extractJsonCandidates(raw)) {
    const plan = toPlan(candidate);
    if (plan) return plan;
  }
  return null;
}

function extractJsonCandidates(raw: string): unknown[] {
  const candidates: unknown[] = [];

  // 1. Anything inside ``` or ```json fences.
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(raw)) !== null) {
    candidates.push(safeParse(match[1] ?? ''));
  }

  // 2. The whole reply, in case the model behaved perfectly.
  candidates.push(safeParse(raw.trim()));

  // 3. Last resort: the first {...} block found anywhere in the text.
  const braceMatch = /\{[\s\S]*\}/.exec(raw);
  if (braceMatch) candidates.push(safeParse(braceMatch[0]));

  return candidates.filter((candidate) => candidate !== undefined);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Validates the parsed value against the Plan shape. We accept both
 * {"steps":[{"id":1,"description":"..."}]} and the looser
 * {"steps":["do this", "do that"]} form, because small models often emit it.
 */
function toPlan(value: unknown): Plan | null {
  if (typeof value !== 'object' || value === null) return null;
  const steps = (value as { steps?: unknown }).steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;

  const parsed: Plan['steps'] = [];
  for (const [index, step] of steps.entries()) {
    if (typeof step === 'string' && step.trim()) {
      parsed.push({ id: index + 1, description: step.trim() });
      continue;
    }
    if (typeof step === 'object' && step !== null) {
      const description = (step as { description?: unknown }).description;
      if (typeof description === 'string' && description.trim()) {
        parsed.push({ id: index + 1, description: description.trim() });
        continue;
      }
    }
    // One malformed step invalidates the whole plan — better to fall back
    // cleanly than to run with a half-broken plan.
    return null;
  }
  return { steps: parsed };
}
