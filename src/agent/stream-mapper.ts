import type { ContentBlock, LlmResponse, StreamEvent } from '../types/index.js';

/**
 * A SDK-free subset of Anthropic's RawMessageStreamEvent.
 *
 * Keeping this shape in our own types means the assembler can be unit-tested
 * without importing the Anthropic SDK (and without a network call).
 * anthropic-client.ts maps real SDK events onto this union.
 */
export type RawStreamEvent =
  | {
      type: 'content_block_start';
      content_block:
        | { type: 'text'; text?: string }
        | { type: 'tool_use'; id: string; name: string; input?: unknown };
    }
  | {
      type: 'content_block_delta';
      delta:
        { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string };
    }
  | { type: 'content_block_stop' }
  | { type: 'message_delta'; delta: { stop_reason?: string | null } }
  | { type: 'message_stop' }
  | { type: 'ignored' };

/**
 * Stateful mapper: Anthropic SSE events -> our StreamEvent union.
 *
 * Why a class, not a pure function? Tool-use arguments arrive as many
 * `input_json_delta` chunks. We have to buffer them until `content_block_stop`
 * before we can emit a complete `tool_use` event. Text deltas, by contrast,
 * are forwarded immediately so the CLI can render tokens as they arrive.
 *
 * Backpressure: callers pull via `push()` / `for await`. If the CLI is slow,
 * the async iterator in AnthropicLlmClient.stream pauses, which pauses the
 * HTTP stream. We do NOT buffer an unbounded string of tokens here.
 */
export class StreamAssembler {
  private stopReason = 'end_turn';
  private readonly blocks: ContentBlock[] = [];
  private currentTool: { id: string; name: string; json: string } | null = null;
  private currentText = '';
  private inTextBlock = false;

  push(event: RawStreamEvent): StreamEvent[] {
    const out: StreamEvent[] = [];

    switch (event.type) {
      case 'content_block_start': {
        if (event.content_block.type === 'tool_use') {
          this.currentTool = {
            id: event.content_block.id,
            name: event.content_block.name,
            json: '',
          };
        } else if (event.content_block.type === 'text') {
          this.inTextBlock = true;
          this.currentText = event.content_block.text ?? '';
        }
        break;
      }
      case 'content_block_delta': {
        if (event.delta.type === 'text_delta') {
          this.currentText += event.delta.text;
          out.push({ type: 'text_delta', text: event.delta.text });
        } else if (event.delta.type === 'input_json_delta' && this.currentTool) {
          this.currentTool.json += event.delta.partial_json;
        }
        break;
      }
      case 'content_block_stop': {
        if (this.currentTool) {
          const input = parseToolInput(this.currentTool.json);
          const block: ContentBlock = {
            type: 'tool_use',
            id: this.currentTool.id,
            name: this.currentTool.name,
            input,
          };
          this.blocks.push(block);
          out.push({
            type: 'tool_use',
            id: this.currentTool.id,
            name: this.currentTool.name,
            input,
          });
          this.currentTool = null;
        } else if (this.inTextBlock) {
          this.blocks.push({ type: 'text', text: this.currentText });
          this.currentText = '';
          this.inTextBlock = false;
        }
        break;
      }
      case 'message_delta': {
        if (event.delta.stop_reason) this.stopReason = event.delta.stop_reason;
        break;
      }
      case 'message_stop': {
        out.push({
          type: 'message_complete',
          response: this.snapshot(),
        });
        break;
      }
      default:
        break;
    }

    return out;
  }

  snapshot(): LlmResponse {
    return { stopReason: this.stopReason, content: [...this.blocks] };
  }
}

/**
 * Narrow an unknown SDK stream event to our RawStreamEvent.
 * Extra event types (message_start, thinking deltas, ...) become `ignored`.
 */
export function toRawStreamEvent(event: unknown): RawStreamEvent {
  if (typeof event !== 'object' || event === null || !('type' in event)) {
    return { type: 'ignored' };
  }
  const typed = event as { type: string; [key: string]: unknown };

  if (typed.type === 'content_block_start') {
    const block = typed.content_block as Record<string, unknown> | undefined;
    if (
      block?.type === 'tool_use' &&
      typeof block.id === 'string' &&
      typeof block.name === 'string'
    ) {
      return {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: block.input },
      };
    }
    if (block?.type === 'text') {
      return {
        type: 'content_block_start',
        content_block: { type: 'text', text: typeof block.text === 'string' ? block.text : '' },
      };
    }
    return { type: 'ignored' };
  }

  if (typed.type === 'content_block_delta') {
    const delta = typed.delta as Record<string, unknown> | undefined;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return { type: 'content_block_delta', delta: { type: 'text_delta', text: delta.text } };
    }
    if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      return {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: delta.partial_json },
      };
    }
    return { type: 'ignored' };
  }

  if (typed.type === 'content_block_stop') return { type: 'content_block_stop' };

  if (typed.type === 'message_delta') {
    const delta = typed.delta as { stop_reason?: string | null } | undefined;
    return { type: 'message_delta', delta: { stop_reason: delta?.stop_reason ?? null } };
  }

  if (typed.type === 'message_stop') return { type: 'message_stop' };

  return { type: 'ignored' };
}

export function parseToolInput(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Split a string into fixed-size chunks — used by tests to fake a token stream. */
export function chunkText(text: string, size: number): string[] {
  if (size <= 0) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
