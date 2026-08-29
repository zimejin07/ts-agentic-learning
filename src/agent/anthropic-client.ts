import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatMessage,
  ContentBlock,
  LlmClient,
  LlmRequest,
  LlmResponse,
} from '../types/index.js';

/**
 * The only file in the project that talks to the Anthropic SDK.
 * It adapts our small internal types (see src/types) onto the real Messages
 * API. Keeping the SDK behind the LlmClient interface means the agent loop —
 * and all the tests — never touch the network.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      system: request.system,
      messages: request.messages.map(toAnthropicMessage),
      tools: request.tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      })),
    });

    return {
      stopReason: response.stop_reason ?? 'end_turn',
      content: response.content.map(toContentBlock),
    };
  }
}

function toAnthropicMessage(message: ChatMessage): Anthropic.MessageParam {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  const blocks = message.content.map((block): Anthropic.ContentBlockParam => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      case 'tool_result':
        return { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content };
    }
  });
  return { role: message.role, content: blocks };
}

function toContentBlock(block: Anthropic.ContentBlock): ContentBlock {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: (block.input ?? {}) as Record<string, unknown>,
    };
  }
  // Other block types (thinking, server-side tools, ...) are out of scope for
  // this learning project; we collapse them to empty text and move on.
  return { type: 'text', text: '' };
}
