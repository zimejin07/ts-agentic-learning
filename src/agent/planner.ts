import type { ContentBlock, LlmClient, Plan } from '../types/index.js';
import { parsePlan } from '../utils/parse-plan.js';
import { PLANNING_SYSTEM_PROMPT } from './prompts.js';

export interface PlanOutcome {
  plan: Plan;
  /** True when the model's reply could not be parsed and we fell back. */
  usedFallback: boolean;
}

/**
 * PLAN phase: asks the model for a step list before any acting happens.
 *
 * If the reply cannot be parsed we fall back to a single "just do the goal"
 * step. A broken plan should degrade the run, never crash it — the agent loop
 * can still make progress without a plan.
 */
export async function createPlan(
  goal: string,
  client: LlmClient,
  abortSignal?: AbortSignal,
): Promise<PlanOutcome> {
  const response = await client.complete({
    system: PLANNING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Goal: ${goal}` }],
    maxTokens: 512,
    abortSignal,
  });

  const text = response.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('\n');

  const plan = parsePlan(text);
  if (plan) return { plan, usedFallback: false };
  return { plan: { steps: [{ id: 1, description: goal }] }, usedFallback: true };
}

function isTextBlock(block: ContentBlock): block is Extract<ContentBlock, { type: 'text' }> {
  return block.type === 'text';
}
