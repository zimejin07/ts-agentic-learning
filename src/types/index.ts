/**
 * Shared types for the whole project.
 *
 * These are deliberately dependency-free: tools, the agent loop, and the tests
 * all import from here, and none of them need to know about the Anthropic SDK.
 * The SDK only appears in `src/agent/anthropic-client.ts`, which translates
 * between these types and the real API. That seam is what makes the agent loop
 * testable without an API key.
 */

/** One step of the plan the model produces before acting. */
export interface PlanStep {
  id: number;
  description: string;
}

export interface Plan {
  steps: PlanStep[];
}

/** The phases of the loop, used both for console logging and the final trace. */
export type TraceEventType = 'plan' | 'act' | 'observe' | 'reflect' | 'answer' | 'warning';

export interface TraceEvent {
  type: TraceEventType;
  /** 0 for the planning phase, otherwise the loop iteration number. */
  iteration: number;
  message: string;
}

export interface AgentResult {
  answer: string;
  plan: Plan;
  trace: TraceEvent[];
  iterations: number;
  hitMaxIterations: boolean;
}

/**
 * JSON-Schema-ish description of a tool's input, sent to the model so it knows
 * what arguments it may pass. We keep it as a plain object instead of pulling
 * in a schema library to stay beginner-friendly.
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * A tool the agent can call. `execute` receives the raw model-provided input,
 * so every tool is responsible for validating its own arguments and returning
 * errors as strings instead of throwing.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute: (input: Record<string, unknown>) => Promise<string> | string;
}

/**
 * Minimal content-block model mirroring the Anthropic Messages API.
 * The loop only ever deals with these three shapes.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface LlmRequest {
  system: string;
  messages: ChatMessage[];
  tools?: Array<Pick<ToolDefinition, 'name' | 'description' | 'inputSchema'>>;
  maxTokens?: number;
}

export interface LlmResponse {
  /** Mirrors Anthropic stop reasons: 'end_turn', 'tool_use', 'max_tokens', ... */
  stopReason: string;
  content: ContentBlock[];
}

/**
 * The seam between the agent and any LLM provider. The agent loop only knows
 * this interface, so tests can substitute a fake client with scripted replies.
 */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
