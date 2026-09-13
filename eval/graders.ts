import type { AgentResult, LlmResponse } from '../src/types/index.js';

export interface ScenarioExpect {
  answerContains?: string[];
  toolsCalled?: string[];
  hitMaxIterations?: boolean;
  planStepCount?: number;
}

export interface Scenario {
  id: string;
  goal: string;
  maxIterations: number;
  scriptedResponses: LlmResponse[];
  expect: ScenarioExpect;
}

export interface GradeFailure {
  check: string;
  detail: string;
}

export interface GradeResult {
  passed: boolean;
  failures: GradeFailure[];
}

function toolsCalledFromTrace(result: AgentResult): string[] {
  return result.trace
    .filter((event) => event.type === 'act')
    .map((event) => event.message.split('(')[0] ?? event.message);
}

/**
 * Deterministic graders for agent *behavior*, not prose quality.
 * These are the kinds of checks you can put in CI without an LLM-as-judge.
 */
export function grade(result: AgentResult, expect: ScenarioExpect): GradeResult {
  const failures: GradeFailure[] = [];

  for (const snippet of expect.answerContains ?? []) {
    if (!result.answer.includes(snippet)) {
      failures.push({
        check: 'answerContains',
        detail: `answer did not include ${JSON.stringify(snippet)}`,
      });
    }
  }

  if (expect.toolsCalled) {
    const actual = toolsCalledFromTrace(result);
    for (const name of expect.toolsCalled) {
      if (!actual.includes(name)) {
        failures.push({
          check: 'toolsCalled',
          detail: `expected a call to "${name}", got [${actual.join(', ')}]`,
        });
      }
    }
  }

  if (
    expect.hitMaxIterations !== undefined &&
    result.hitMaxIterations !== expect.hitMaxIterations
  ) {
    failures.push({
      check: 'hitMaxIterations',
      detail: `expected ${expect.hitMaxIterations}, got ${result.hitMaxIterations}`,
    });
  }

  if (expect.planStepCount !== undefined && result.plan.steps.length !== expect.planStepCount) {
    failures.push({
      check: 'planStepCount',
      detail: `expected ${expect.planStepCount} plan steps, got ${result.plan.steps.length}`,
    });
  }

  return { passed: failures.length === 0, failures };
}
