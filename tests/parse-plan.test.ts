import { describe, expect, it } from 'vitest';
import { parsePlan } from '../src/utils/parse-plan.js';

describe('parsePlan', () => {
  it('parses clean JSON', () => {
    const plan = parsePlan(
      '{"steps":[{"id":1,"description":"Do A"},{"id":2,"description":"Do B"}]}',
    );
    expect(plan).toEqual({
      steps: [
        { id: 1, description: 'Do A' },
        { id: 2, description: 'Do B' },
      ],
    });
  });

  it('parses JSON wrapped in markdown fences', () => {
    const raw = 'Here is the plan:\n```json\n{"steps":[{"id":1,"description":"Do A"}]}\n```\nDone.';
    const plan = parsePlan(raw);
    expect(plan?.steps[0]?.description).toBe('Do A');
    expect(plan?.steps).toHaveLength(1);
  });

  it('accepts steps given as plain strings and renumbers them', () => {
    const plan = parsePlan('{"steps":["First thing","Second thing"]}');
    expect(plan?.steps).toEqual([
      { id: 1, description: 'First thing' },
      { id: 2, description: 'Second thing' },
    ]);
  });

  it('extracts the first JSON object from surrounding chatter', () => {
    const plan = parsePlan('Sure! {"steps":[{"description":"Only step"}]} Hope that helps.');
    expect(plan?.steps).toHaveLength(1);
  });

  it('returns null for garbage', () => {
    expect(parsePlan('no json here at all')).toBeNull();
  });

  it('returns null for an empty steps array', () => {
    expect(parsePlan('{"steps":[]}')).toBeNull();
  });

  it('returns null when a step is malformed', () => {
    expect(parsePlan('{"steps":[{"description":"ok"},42]}')).toBeNull();
  });
});
