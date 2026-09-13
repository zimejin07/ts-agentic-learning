import type { ApprovalRequest, ToolDefinition } from '../types/index.js';
import { bookFlightTool, getFareTool, searchFlightsTool } from './airline.js';
import { calculatorTool } from './calculator.js';
import { currentTimeTool } from './current-time.js';
import { webSearchTool } from './web-search.js';

/**
 * The tool registry. To add a new tool: create a file in this folder, export a
 * ToolDefinition, and add it to this array. Nothing else needs to change.
 */
export const tools: ToolDefinition[] = [
  calculatorTool,
  currentTimeTool,
  webSearchTool,
  searchFlightsTool,
  getFareTool,
  bookFlightTool,
];

const registry = new Map(tools.map((tool) => [tool.name, tool]));

export interface ExecuteToolOptions {
  /** Called only after Zod + preflight pass, and only if the tool requires approval. */
  onApprove?: (request: ApprovalRequest) => Promise<boolean>;
}

/**
 * Runs a tool by name. This function NEVER throws: every failure (unknown
 * tool, bad arguments, crash inside the tool) is converted into an error
 * string so the loop can observe it and recover instead of dying.
 *
 * Production wrap (see LEARNING.md): schema-validate args *before* execute,
 * HITL for writes, per-tool timeouts; only abort should throw.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  options: ExecuteToolOptions = {},
): Promise<string> {
  const tool = registry.get(name);
  if (!tool) {
    return `Error: unknown tool "${name}". Available tools: ${tools.map((t) => t.name).join(', ')}.`;
  }
  let args = input;
  if (tool.argsSchema) {
    const parsed = tool.argsSchema.safeParse(input);
    if (!parsed.success) {
      const detail =
        parsed.error.issues.map((issue) => issue.message).join('; ') || 'invalid input';
      return `Error: invalid arguments for "${name}": ${detail}`;
    }
    args = parsed.data;
  }

  const preflightError = tool.preflight?.(args);
  if (preflightError) {
    return preflightError;
  }

  if (tool.requiresApproval) {
    const summary = tool.approvalSummary?.(args) ?? `${name}(${JSON.stringify(args)})`;
    const approved = options.onApprove
      ? await options.onApprove({ toolName: name, input: args, summary })
      : false;
    if (!approved) {
      return `Error: user declined ${name}. Do not retry the same booking.`;
    }
  }

  try {
    return await tool.execute(args);
  } catch (error) {
    return `Error while running "${name}": ${error instanceof Error ? error.message : String(error)}`;
  }
}
