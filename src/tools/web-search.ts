import type { ToolDefinition } from '../types/index.js';

/**
 * A MOCK web search backed by a tiny in-memory index.
 *
 * It does not touch the network. That is intentional for a learning project:
 * runs are deterministic, free, and safe in tests. The tool interface is the
 * same shape a real search tool would have, so swapping in a real API later
 * only means rewriting `execute`.
 */
const MOCK_INDEX: Array<{ keywords: string[]; title: string; snippet: string; url: string }> = [
  {
    keywords: ['agent', 'agentic', 'ai'],
    title: 'What is an AI agent?',
    snippet:
      'An AI agent is a system that uses an LLM to decide which actions to take, typically looping through planning, acting on tools, and observing results.',
    url: 'https://example.com/ai-agents',
  },
  {
    keywords: ['typescript', 'ts'],
    title: 'TypeScript in one sentence',
    snippet:
      'TypeScript is JavaScript with static types, catching whole classes of bugs at compile time instead of at runtime.',
    url: 'https://example.com/typescript',
  },
  {
    keywords: ['node', 'nodejs', 'node.js'],
    title: 'What is Node.js?',
    snippet:
      'Node.js is a JavaScript runtime built on the V8 engine that lets you run JavaScript outside the browser, commonly for servers and CLI tools.',
    url: 'https://example.com/node',
  },
  {
    keywords: ['pnpm', 'package'],
    title: 'Why pnpm?',
    snippet:
      'pnpm is a fast, disk-space-efficient package manager that stores packages in a global content-addressable store and links them into projects.',
    url: 'https://example.com/pnpm',
  },
  {
    keywords: ['claude', 'anthropic', 'llm'],
    title: 'Claude and the Anthropic API',
    snippet:
      "Claude is Anthropic's family of LLMs. The Messages API supports tool use, where the model can request function calls and receive their results.",
    url: 'https://example.com/claude',
  },
];

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the web for information on a topic. NOTE: this is a mock backed by a tiny built-in index, not the real internet.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
    },
    required: ['query'],
  },
  execute: (input) => {
    const query = typeof input.query === 'string' ? input.query.toLowerCase().trim() : '';
    if (!query) return 'Error: "query" must be a non-empty string.';
    const hits = MOCK_INDEX.filter((entry) =>
      entry.keywords.some((keyword) => query.includes(keyword)),
    ).slice(0, 3);
    if (hits.length === 0) {
      return 'No results found (the mock index is tiny — try "agent", "typescript", "node", "pnpm", or "claude").';
    }
    return hits.map((hit) => `${hit.title}\n${hit.snippet}\nSource: ${hit.url}`).join('\n\n');
  },
};
