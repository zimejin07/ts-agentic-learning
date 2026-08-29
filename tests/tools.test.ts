import { describe, expect, it } from 'vitest';
import { calculate, calculatorTool } from '../src/tools/calculator.js';
import { currentTimeTool } from '../src/tools/current-time.js';
import { webSearchTool } from '../src/tools/web-search.js';
import { executeTool, tools } from '../src/tools/index.js';

describe('calculator', () => {
  it('respects operator precedence', () => {
    expect(calculate('2 + 3 * 4')).toBe(14);
  });

  it('handles parentheses', () => {
    expect(calculate('2 * (3 + 4)')).toBe(14);
  });

  it('handles decimals and unary minus', () => {
    expect(calculate('-1.5 + 2')).toBe(0.5);
  });

  it('rejects division by zero', () => {
    expect(() => calculate('1 / 0')).toThrow();
  });

  it('rejects unsupported characters (no eval escape hatch)', () => {
    expect(() => calculate('process.exit(1)')).toThrow();
  });

  it('returns errors as strings through the tool interface', async () => {
    const result = await calculatorTool.execute({ expression: '1 +' });
    expect(result).toMatch(/^Error:/);
  });

  it('rejects non-string input', async () => {
    const result = await calculatorTool.execute({ expression: 42 });
    expect(result).toMatch(/^Error:/);
  });
});

describe('current_time', () => {
  it('returns an ISO timestamp', async () => {
    const result = await currentTimeTool.execute({});
    expect(result).toMatch(/ISO: \d{4}-\d{2}-\d{2}T/);
  });

  it('rejects a bogus timezone', async () => {
    const result = await currentTimeTool.execute({ timezone: 'Not/AZone' });
    expect(result).toMatch(/^Error:/);
  });
});

describe('web_search (mock)', () => {
  it('finds results for known topics', async () => {
    const result = await webSearchTool.execute({ query: 'what is an AI agent?' });
    expect(result).toContain('What is an AI agent?');
  });

  it('says when nothing matches', async () => {
    const result = await webSearchTool.execute({ query: 'zebra quantum toaster' });
    expect(result).toContain('No results found');
  });
});

describe('tool registry', () => {
  it('exposes at least three tools', () => {
    expect(tools.length).toBeGreaterThanOrEqual(3);
  });

  it('never throws on unknown (hallucinated) tool names', async () => {
    const result = await executeTool('definitely_not_a_tool', {});
    expect(result).toContain('unknown tool');
  });

  it('routes calls to the right tool', async () => {
    const result = await executeTool('calculator', { expression: '6 * 7' });
    expect(result).toBe('42');
  });
});
