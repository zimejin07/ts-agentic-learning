import { describe, expect, it } from 'vitest';
import { grade, type ScenarioExpect } from '../eval/graders.js';
import type { AgentResult } from '../src/types/index.js';

function result(overrides: Partial<AgentResult>): AgentResult {
  return {
    answer: '24 * 7 is 168.',
    plan: { steps: [{ id: 1, description: 'Compute' }] },
    trace: [
      { type: 'act', iteration: 1, message: 'calculator({"expression":"24 * 7"})' },
      { type: 'observe', iteration: 1, message: '168' },
    ],
    iterations: 2,
    hitMaxIterations: false,
    ...overrides,
  };
}

describe('grade', () => {
  const happy: ScenarioExpect = {
    answerContains: ['168'],
    toolsCalled: ['calculator'],
    hitMaxIterations: false,
    planStepCount: 1,
  };

  it('passes when all checks hold', () => {
    expect(grade(result({}), happy).passed).toBe(true);
  });

  it('fails answerContains when the snippet is missing', () => {
    const graded = grade(result({ answer: 'I dunno' }), happy);
    expect(graded.passed).toBe(false);
    expect(graded.failures.some((f) => f.check === 'answerContains')).toBe(true);
  });

  it('fails toolsCalled when the tool was never invoked', () => {
    const graded = grade(result({ trace: [] }), happy);
    expect(graded.failures.some((f) => f.check === 'toolsCalled')).toBe(true);
  });

  it('fails hitMaxIterations on mismatch', () => {
    const graded = grade(result({ hitMaxIterations: true }), happy);
    expect(graded.failures.some((f) => f.check === 'hitMaxIterations')).toBe(true);
  });
});
