/**
 * Eval runner: loads JSON scenarios, runs the agent against a fake LLM,
 * and scores the result with deterministic graders.
 *
 * This is NOT an LLM-as-judge. CI must stay free of API keys and of
 * non-deterministic model output. Live-model eval is explicitly out of scope
 * (`EVAL_LIVE=1` exits with an explanation rather than calling Anthropic).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../src/agent/loop.js';
import { tools } from '../src/tools/index.js';
import { FakeClient } from './fake-client.js';
import { grade, type Scenario } from './graders.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const scenariosDir = path.join(here, 'scenarios');

async function loadScenarios(): Promise<Scenario[]> {
  const files = (await readdir(scenariosDir)).filter((name) => name.endsWith('.json')).sort();
  const scenarios: Scenario[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(scenariosDir, file), 'utf8');
    scenarios.push(JSON.parse(raw) as Scenario);
  }
  return scenarios;
}

async function main(): Promise<void> {
  if (process.env.EVAL_LIVE === '1') {
    console.error(
      'EVAL_LIVE=1 is not supported. This harness scores scripted FakeClient runs only — live model eval is non-deterministic and stays out of CI.',
    );
    process.exit(1);
  }

  const scenarios = await loadScenarios();
  let failed = 0;

  console.log(`Running ${scenarios.length} eval scenario(s) (fake LLM, no API key)\n`);

  for (const scenario of scenarios) {
    const client = new FakeClient(scenario.scriptedResponses);
    const result = await runAgent({
      goal: scenario.goal,
      client,
      tools,
      maxIterations: scenario.maxIterations,
    });
    const graded = grade(result, scenario.expect);
    if (graded.passed) {
      console.log(`PASS  ${scenario.id}`);
    } else {
      failed++;
      console.log(`FAIL  ${scenario.id}`);
      for (const failure of graded.failures) {
        console.log(`      - ${failure.check}: ${failure.detail}`);
      }
    }
  }

  console.log(`\n${scenarios.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
