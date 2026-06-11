import { describe, it, expect } from 'vitest';
import { scenarioKind } from '../src/orchestrator/scenarioKind.js';

describe('scenarioKind', () => {
  it('classifies single vs operation scenarios', () => {
    expect(scenarioKind({ campaignId: 'a', targetId: 'x', objective: {} })).toBe('single');
    expect(scenarioKind({ campaignId: 'b', goal: 'g', roster: [] })).toBe('operation');
  });

  it('throws on a half-specified operation scenario (never silently falls through)', () => {
    expect(() => scenarioKind({ roster: [] })).toThrow(/Malformed/i);
    expect(() => scenarioKind({ goal: 'g' })).toThrow(/Malformed/i);
  });
});
