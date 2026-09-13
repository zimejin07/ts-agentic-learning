import type { ContentBlock, LlmClient, LlmResponse, Plan } from '../types/index.js';
import { parsePlan } from '../utils/parse-plan.js';
import { PLANNING_SYSTEM_PROMPT } from './prompts.js';

export interface PlanOutcome {
  plan: Plan;
  usedFallback: boolean;
  usage?: LlmResponse['usage'];
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
  if (plan) return { plan, usedFallback: false, usage: response.usage };
  return {
    plan: { steps: [{ id: 1, description: goal }] },
    usedFallback: true,
    usage: response.usage,
  };
}

function isTextBlock(block: ContentBlock): block is Extract<ContentBlock, { type: 'text' }> {
  return block.type === 'text';
}
