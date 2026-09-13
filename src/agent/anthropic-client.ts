import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatMessage,
  ContentBlock,
  LlmClient,
  LlmRequest,
  LlmResponse,
  StreamEvent,
} from '../types/index.js';
import { StreamAssembler, toRawStreamEvent } from './stream-mapper.js';

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
    throwIfAborted(request.abortSignal);
    const response = await this.client.messages.create(
      { ...this.toCreateParams(request), stream: false },
      request.abortSignal ? { signal: request.abortSignal } : undefined,
    );

    return {
      stopReason: response.stop_reason ?? 'end_turn',
      content: response.content.map(toContentBlock),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Live token stream. The `for await` here IS the backpressure valve: if the
   * CLI is slow to pull the next event, this iterator pauses, which pauses
   * reading the HTTP body.
   */
  async *stream(request: LlmRequest): AsyncIterable<StreamEvent> {
    throwIfAborted(request.abortSignal);
    const assembler = new StreamAssembler();
    const sdkStream = this.client.messages.stream(
      this.toCreateParams(request),
      request.abortSignal ? { signal: request.abortSignal } : undefined,
    );

    for await (const event of sdkStream) {
      throwIfAborted(request.abortSignal);
      const mapped = assembler.push(toRawStreamEvent(event));
      for (const item of mapped) {
        if (item.type === 'message_complete') continue;
        yield item;
      }
    }

    const final = await sdkStream.finalMessage();
    yield {
      type: 'message_complete',
      response: {
        stopReason: final.stop_reason ?? 'end_turn',
        content: final.content.map(toContentBlock),
        usage: {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
        },
      },
    };
  }

  private toCreateParams(request: LlmRequest): Anthropic.MessageCreateParamsNonStreaming {
    return {
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      system: request.system,
      messages: request.messages.map(toAnthropicMessage),
      tools: request.tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      })),
    };
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Aborted');
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
