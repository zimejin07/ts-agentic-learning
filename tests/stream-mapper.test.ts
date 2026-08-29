import { describe, expect, it } from 'vitest';
import {
  StreamAssembler,
  chunkText,
  parseToolInput,
  toRawStreamEvent,
} from '../src/agent/stream-mapper.js';

describe('chunkText', () => {
  it('splits a string into fixed-size chunks', () => {
    expect(chunkText('abcdefgh', 4)).toEqual(['abcd', 'efgh']);
    expect(chunkText('abcde', 4)).toEqual(['abcd', 'e']);
  });
});

describe('parseToolInput', () => {
  it('parses object JSON', () => {
    expect(parseToolInput('{"expression":"1+1"}')).toEqual({ expression: '1+1' });
  });

  it('returns {} for empty, invalid, or non-object JSON', () => {
    expect(parseToolInput('')).toEqual({});
    expect(parseToolInput('not json')).toEqual({});
    expect(parseToolInput('[1,2]')).toEqual({});
  });
});

describe('toRawStreamEvent', () => {
  it('maps text deltas and ignores unknown events', () => {
    expect(
      toRawStreamEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }),
    ).toEqual({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } });
    expect(toRawStreamEvent({ type: 'message_start' })).toEqual({ type: 'ignored' });
    expect(toRawStreamEvent(null)).toEqual({ type: 'ignored' });
  });
});

describe('StreamAssembler', () => {
  it('forwards text deltas immediately and completes the message', () => {
    const assembler = new StreamAssembler();
    const events = [
      ...assembler.push({ type: 'content_block_start', content_block: { type: 'text', text: '' } }),
      ...assembler.push({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hel' },
      }),
      ...assembler.push({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'lo' },
      }),
      ...assembler.push({ type: 'content_block_stop' }),
      ...assembler.push({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
      ...assembler.push({ type: 'message_stop' }),
    ];

    expect(
      events.filter((e) => e.type === 'text_delta').map((e) => e.type === 'text_delta' && e.text),
    ).toEqual(['Hel', 'lo']);
    const complete = events.find((e) => e.type === 'message_complete');
    expect(complete).toEqual({
      type: 'message_complete',
      response: { stopReason: 'end_turn', content: [{ type: 'text', text: 'Hello' }] },
    });
  });

  it('emits tool_use only after the JSON has been assembled', () => {
    const assembler = new StreamAssembler();
    const mid = assembler.push({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 't1', name: 'calculator' },
    });
    expect(mid).toEqual([]);

    assembler.push({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"expression":' },
    });
    const done = assembler.push({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '"2+2"}' },
    });
    expect(done).toEqual([]);

    const stopped = assembler.push({ type: 'content_block_stop' });
    expect(stopped).toEqual([
      { type: 'tool_use', id: 't1', name: 'calculator', input: { expression: '2+2' } },
    ]);
  });
});
