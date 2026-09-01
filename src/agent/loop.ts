import type {
  AgentResult,
  ChatMessage,
  ContentBlock,
  LlmClient,
  LlmRequest,
  LlmResponse,
  ToolDefinition,
  TraceEvent,
  TraceEventType,
} from '../types/index.js';
import { executeTool } from '../tools/index.js';
import {
  getKeepLastTurns,
  getRetryDelayMs,
  getRetryAttempts,
  getTokenBudget,
} from '../utils/env.js';
import { fingerprintCall, totalTokens, trimMessages, withRetry } from './loop-guards.js';
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
  /**
   * Live token callback. Fired for each text_delta when the client supports
   * streaming. Tokens are NOT stored in the trace (that would explode the log).
   */
  onToken?: (text: string) => void;
  /** Ctrl+C / cancel. Checked between iterations and forwarded to the LLM. */
  abortSignal?: AbortSignal;
  /** Stop once cumulative input+output tokens reach this. Unset = no budget. */
  tokenBudget?: number;
  /** How many assistant/user pairs to keep. 0 = never trim. */
  keepLastTurns?: number;
  /** Extra LLM attempts after a 429/5xx. 0 = try once. */
  retryAttempts?: number;
  retryDelayMs?: number;
}

/**
 * The core agent loop: PLAN -> (ACT -> OBSERVE -> REFLECT)* -> ANSWER.
 *
 * Loop engineering (see loop-guards.ts):
 *   - retry 429/5xx
 *   - token budget alongside the iteration cap
 *   - refuse duplicate tool+args
 *   - trim old turns so history cannot grow forever
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const { goal, client, tools, maxIterations, onEvent, onToken, abortSignal } = options;
  const tokenBudget = options.tokenBudget ?? getTokenBudget();
  const keepLastTurns = options.keepLastTurns ?? getKeepLastTurns();
  const retryAttempts = options.retryAttempts ?? getRetryAttempts();
  const retryDelayMs = options.retryDelayMs ?? getRetryDelayMs();

  const trace: TraceEvent[] = [];
  const emit = (type: TraceEventType, iteration: number, message: string) => {
    const event: TraceEvent = { type, iteration, message };
    trace.push(event);
    onEvent?.(event);
  };

  throwIfAborted(abortSignal);

  const retry = { extraAttempts: retryAttempts, delayMs: retryDelayMs, abortSignal };
  let tokensUsed = 0;
  let lastModelText = '';
  let iterations = 0;
  const seenCalls = new Set<string>();

  // ---------- PLAN ----------
  const {
    plan,
    usedFallback,
    usage: planUsage,
  } = await withRetry(() => createPlan(goal, client, abortSignal), retry);
  tokensUsed += totalTokens(planUsage);
  if (usedFallback) {
    emit('warning', 0, 'Could not parse the model plan; falling back to a single-step plan.');
  }
  emit('plan', 0, plan.steps.map((step) => `${step.id}. ${step.description}`).join('\n'));

  const planText = plan.steps.map((step) => `${step.id}. ${step.description}`).join('\n');
  let messages: ChatMessage[] = [
    {
      role: 'user',
      content: `Goal: ${goal}\n\nPlan:\n${planText}\n\nWork through the plan. Use tools when they help.`,
    },
  ];

  const stopForBudget = (iteration: number): AgentResult => {
    emit('warning', iteration, `Token budget (${tokenBudget}) reached after ${tokensUsed} tokens.`);
    const answer = lastModelText
      ? `${lastModelText}\n\n(Note: stopped after hitting the token budget, answer may be incomplete.)`
      : `Stopped after hitting the token budget (${tokenBudget}).`;
    emit('answer', iteration, answer);
    return {
      answer,
      plan,
      trace,
      iterations,
      hitMaxIterations: false,
      hitTokenBudget: true,
      tokensUsed,
    };
  };

  if (tokenBudget !== undefined && tokensUsed >= tokenBudget) {
    return stopForBudget(0);
  }

  // ---------- ACT / OBSERVE / REFLECT loop ----------
  while (iterations < maxIterations) {
    throwIfAborted(abortSignal);
    iterations++;

    const trimmed = trimMessages(messages, keepLastTurns);
    if (trimmed.droppedPairs > 0) {
      emit(
        'warning',
        iterations,
        `Trimmed ${trimmed.droppedPairs} older turn(s) to keep the last ${keepLastTurns}.`,
      );
      messages = trimmed.messages;
    }

    const response = await withRetry(
      () =>
        completeTurn(
          client,
          {
            system: AGENT_SYSTEM_PROMPT,
            messages,
            tools,
            maxTokens: 1024,
            abortSignal,
          },
          onToken,
        ),
      retry,
    );

    tokensUsed += totalTokens(response.usage);
    if (tokenBudget !== undefined && tokensUsed >= tokenBudget) {
      const textBlocks = response.content.filter(isTextBlock);
      const preview = textBlocks
        .map((block) => block.text)
        .join('\n')
        .trim();
      if (preview) lastModelText = preview;
      return stopForBudget(iterations);
    }

    const textBlocks = response.content.filter(isTextBlock);
    const toolUses = response.content.filter(isToolUseBlock);

    messages.push({ role: 'assistant', content: response.content });

    if (toolUses.length === 0) {
      const answer =
        textBlocks
          .map((block) => block.text)
          .join('\n')
          .trim() || 'The agent finished without producing a final text answer.';
      emit('answer', iterations, answer);
      return {
        answer,
        plan,
        trace,
        iterations,
        hitMaxIterations: false,
        hitTokenBudget: false,
        tokensUsed,
      };
    }

    for (const block of textBlocks) {
      if (block.text.trim()) {
        lastModelText = block.text.trim();
        emit('reflect', iterations, block.text.trim());
      }
    }

    const toolResults: ContentBlock[] = [];
    for (const toolUse of toolUses) {
      const fp = fingerprintCall(toolUse.name, toolUse.input);
      emit('act', iterations, `${toolUse.name}(${JSON.stringify(toolUse.input)})`);
      let output: string;
      if (seenCalls.has(fp)) {
        output = `Error: already called "${toolUse.name}" with these arguments. Do not repeat; answer or try a different call.`;
        emit('warning', iterations, `Blocked repeat call to ${toolUse.name}.`);
      } else {
        seenCalls.add(fp);
        output = await executeTool(toolUse.name, toolUse.input);
      }
      emit('observe', iterations, truncate(output, 500));
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  emit('warning', iterations, `Max iteration cap (${maxIterations}) reached.`);
  const answer = lastModelText
    ? `${lastModelText}\n\n(Note: stopped after ${maxIterations} iterations, answer may be incomplete.)`
    : `Stopped after reaching the max iteration cap (${maxIterations}) without a final answer.`;
  emit('answer', iterations, answer);
  return {
    answer,
    plan,
    trace,
    iterations,
    hitMaxIterations: true,
    hitTokenBudget: false,
    tokensUsed,
  };
}

async function completeTurn(
  client: LlmClient,
  request: LlmRequest,
  onToken: ((text: string) => void) | undefined,
): Promise<LlmResponse> {
  if (!client.stream) {
    return client.complete(request);
  }

  let final: LlmResponse | null = null;
  for await (const event of client.stream(request)) {
    if (event.type === 'text_delta') onToken?.(event.text);
    if (event.type === 'message_complete') final = event.response;
  }
  if (!final) {
    throw new Error('Stream ended without a complete message');
  }
  return final;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Aborted');
  }
}

function isTextBlock(block: ContentBlock): block is Extract<ContentBlock, { type: 'text' }> {
  return block.type === 'text';
}

function isToolUseBlock(block: ContentBlock): block is Extract<ContentBlock, { type: 'tool_use' }> {
  return block.type === 'tool_use';
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
