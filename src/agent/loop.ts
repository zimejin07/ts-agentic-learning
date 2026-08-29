import type {
  AgentResult,
  ChatMessage,
  ContentBlock,
  LlmClient,
  ToolDefinition,
  TraceEvent,
  TraceEventType,
} from '../types/index.js';
import { executeTool } from '../tools/index.js';
import { createPlan } from './planner.js';
import { AGENT_SYSTEM_PROMPT } from './prompts.js';

export interface RunAgentOptions {
  goal: string;
  client: LlmClient;
  tools: ToolDefinition[];
  /** Hard safety cap. The loop can never exceed this many LLM rounds. */
  maxIterations: number;
  /** Optional callback so the CLI can stream events to the console live. */
  onEvent?: (event: TraceEvent) => void;
}

/**
 * The core agent loop: PLAN -> (ACT -> OBSERVE -> REFLECT)* -> ANSWER.
 *
 * State lives in two places:
 *   - `messages`: the conversation history sent back to the model each round
 *     (this IS the agent's memory — there is no other store).
 *   - `trace`: a structured log of everything that happened, returned at the
 *     end so callers can inspect or print the full run.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const { goal, client, tools, maxIterations, onEvent } = options;
  const trace: TraceEvent[] = [];
  const emit = (type: TraceEventType, iteration: number, message: string) => {
    const event: TraceEvent = { type, iteration, message };
    trace.push(event);
    onEvent?.(event);
  };

  // ---------- PLAN ----------
  const { plan, usedFallback } = await createPlan(goal, client);
  if (usedFallback) {
    emit('warning', 0, 'Could not parse the model plan; falling back to a single-step plan.');
  }
  emit('plan', 0, plan.steps.map((step) => `${step.id}. ${step.description}`).join('\n'));

  const planText = plan.steps.map((step) => `${step.id}. ${step.description}`).join('\n');
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: `Goal: ${goal}\n\nPlan:\n${planText}\n\nWork through the plan. Use tools when they help.`,
    },
  ];

  let lastModelText = '';
  let iterations = 0;

  // ---------- ACT / OBSERVE / REFLECT loop ----------
  while (iterations < maxIterations) {
    iterations++;

    const response = await client.complete({
      system: AGENT_SYSTEM_PROMPT,
      messages,
      tools,
      maxTokens: 1024,
    });

    const textBlocks = response.content.filter(isTextBlock);
    const toolUses = response.content.filter(isToolUseBlock);

    // The assistant turn must be appended verbatim (including tool_use blocks)
    // before we send tool results back — the API requires this pairing.
    messages.push({ role: 'assistant', content: response.content });

    // No tool calls means the model considers itself done: its text IS the answer.
    if (toolUses.length === 0) {
      const answer =
        textBlocks
          .map((block) => block.text)
          .join('\n')
          .trim() || 'The agent finished without producing a final text answer.';
      emit('answer', iterations, answer);
      return { answer, plan, trace, iterations, hitMaxIterations: false };
    }

    // REFLECT: any text alongside tool calls is the model reasoning out loud
    // about what it just saw or is about to do. We surface it, and remember it
    // as the best answer-so-far in case we hit the iteration cap.
    for (const block of textBlocks) {
      if (block.text.trim()) {
        lastModelText = block.text.trim();
        emit('reflect', iterations, block.text.trim());
      }
    }

    // ACT + OBSERVE: run each requested tool (sequentially, on purpose — see
    // ARCHITECTURE.md) and append the results as the next user message.
    const toolResults: ContentBlock[] = [];
    for (const toolUse of toolUses) {
      emit('act', iterations, `${toolUse.name}(${JSON.stringify(toolUse.input)})`);
      const output = await executeTool(toolUse.name, toolUse.input);
      emit('observe', iterations, truncate(output, 500));
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  // ---------- Max-iteration safety valve ----------
  emit('warning', iterations, `Max iteration cap (${maxIterations}) reached.`);
  const answer = lastModelText
    ? `${lastModelText}\n\n(Note: stopped after ${maxIterations} iterations, answer may be incomplete.)`
    : `Stopped after reaching the max iteration cap (${maxIterations}) without a final answer.`;
  emit('answer', iterations, answer);
  return { answer, plan, trace, iterations, hitMaxIterations: true };
}

function isTextBlock(block: ContentBlock): block is Extract<ContentBlock, { type: 'text' }> {
  return block.type === 'text';
}

function isToolUseBlock(block: ContentBlock): block is Extract<ContentBlock, { type: 'tool_use' }> {
  return block.type === 'tool_use';
}

/** Keeps observations readable in the console; the full output still goes to the model. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
