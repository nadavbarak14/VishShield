import { describe, it, expect } from 'vitest';
import { composeGuidance } from '../src/orchestrator/composeGuidance.js';
import type { Tactic } from '../src/types.js';

const tactics: Tactic[] = [
  { id: 'a', name: 'Alpha', summary: 's', instructions: 'do alpha' },
  { id: 'b', name: 'Beta', summary: 's', instructions: 'do beta' },
];

describe('composeGuidance', () => {
  it('lists the tactics as numbered approaches', () => {
    const g = composeGuidance(tactics);
    expect(g).toContain('extract any sensitive secret');
    expect(g).toContain('1. Alpha — do alpha');
    expect(g).toContain('2. Beta — do beta');
    expect(g).not.toContain('Preferred entry point');
  });

  it('appends the preferred entry point when given', () => {
    const g = composeGuidance(tactics, { name: 'Sam Okafor', title: 'SRE' });
    expect(g).toContain('Preferred entry point: Sam Okafor (SRE).');
    expect(g).toContain('free to call anyone');
  });
});
