import type { ToolDefinition } from '../types/index.js';
import { calculatorTool } from './calculator.js';
import { currentTimeTool } from './current-time.js';
import { webSearchTool } from './web-search.js';

/**
 * The tool registry. To add a new tool: create a file in this folder, export a
 * ToolDefinition, and add it to this array. Nothing else needs to change.
 */
export const tools: ToolDefinition[] = [calculatorTool, currentTimeTool, webSearchTool];

const registry = new Map(tools.map((tool) => [tool.name, tool]));

/**
 * Runs a tool by name. This function NEVER throws: every failure (unknown
 * tool, bad arguments, crash inside the tool) is converted into an error
 * string so the loop can observe it and recover instead of dying.
 *
 * Production wrap (see LEARNING.md): schema-validate args *before* execute,
 * HITL for writes, per-tool timeouts; only abort should throw.
 */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  const tool = registry.get(name);
  if (!tool) {
    // The model hallucinated a tool name — tell it what actually exists.
    return `Error: unknown tool "${name}". Available tools: ${tools.map((t) => t.name).join(', ')}.`;
  }
  try {
    return await tool.execute(input);
  } catch (error) {
    return `Error while running "${name}": ${error instanceof Error ? error.message : String(error)}`;
  }
}
