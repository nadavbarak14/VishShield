import { describe, it, expect } from 'vitest';
import { SYSTEM, buildOperatorPrompt } from '../src/operator/operatorPrompt.js';
import type { Person } from '../src/types.js';

const people: Person[] = [
  { id: 'a', name: 'A Person', title: 'Service Desk', phone: '1', publicInfo: 'on LinkedIn' },
  { id: 'b', name: 'B Person', title: 'SRE', phone: '2', department: 'Infra' },
];

describe('operatorPrompt', () => {
  it('SYSTEM contains the JSON-only contract and the goal-met stop rule', () => {
    expect(SYSTEM).toContain('Reply with ONLY a JSON object');
    expect(SYSTEM).toContain('STOP AS SOON AS THE GOAL IS MET');
  });

  it('first-turn prompt renders goal, roster, empty notes and the first-turn instruction', () => {
    const p = buildOperatorPrompt('get the token', people, [], { history: [] });
    expect(p).toContain('Engagement goal: get the token');
    expect(p).toContain('- id: a | A Person, Service Desk | phone 1 | on LinkedIn');
    expect(p).toContain('- id: b | B Person, SRE, Infra | phone 2');
    expect(p).toContain('Your notes so far:\n(no notes yet)');
    expect(p).toContain('Past calls you can recall in full:\n(no past calls yet)');
    expect(p).toContain('This is your FIRST turn');
  });

  it('after a call wave it renders the results block with the leak verdict', () => {
    const p = buildOperatorPrompt('g', people, ['note one'], {
      last: [{ hopId: 1, personId: 'a', leaked: true, transcript: [{ speaker: 'target', text: 'ok: SECRET' }] }],
      history: [{ hopId: 1, personId: 'a' }],
    });
    expect(p).toContain('1. note one');
    expect(p).toContain('Your most recent call just finished.');
    expect(p).toContain('Call 1, to "a" — leak detected: YES.');
    expect(p).toContain('TARGET: ok: SECRET');
  });
});
