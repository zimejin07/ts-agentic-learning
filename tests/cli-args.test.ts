import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/cli/approve.js';

describe('parseCliArgs', () => {
  it('strips --yes from the front', () => {
    expect(parseCliArgs(['node', 'cli', '--yes', 'Book a flight'])).toEqual({
      goal: 'Book a flight',
      autoApprove: true,
    });
  });

  it('strips --yes from the end', () => {
    expect(parseCliArgs(['node', 'cli', 'Book a flight', '--yes'])).toEqual({
      goal: 'Book a flight',
      autoApprove: true,
    });
  });

  it('defaults to asking for approval', () => {
    expect(parseCliArgs(['node', 'cli', 'What time is it?'])).toEqual({
      goal: 'What time is it?',
      autoApprove: false,
    });
  });
});
