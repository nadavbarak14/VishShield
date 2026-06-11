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

  it('renders the recalled-transcript branch when input.recalled is set', () => {
    const p = buildOperatorPrompt('g', people, [], {
      recalled: { hopId: 2, transcript: [{ speaker: 'agent', text: 'hello there' }, { speaker: 'target', text: 'who is this' }] },
      history: [{ hopId: 2, personId: 'a' }],
    });
    expect(p).toContain('Full transcript of hop 2 you requested:');
    expect(p).toContain('CALLER: hello there');
    expect(p).toContain('TARGET: who is this');
    expect(p).toContain('Now return your next JSON decision');
    expect(p).not.toContain('Your most recent call just finished.');
  });

  it('renders the plural wave intro for a multi-call result set', () => {
    const p = buildOperatorPrompt('g', people, [], {
      last: [
        { hopId: 1, personId: 'a', leaked: false, transcript: [{ speaker: 'target', text: 'no' }] },
        { hopId: 2, personId: 'b', leaked: true, transcript: [{ speaker: 'target', text: 'ok: X' }] },
      ],
      history: [{ hopId: 1, personId: 'a' }, { hopId: 2, personId: 'b' }],
    });
    expect(p).toContain('Your most recent wave of 2 parallel calls just finished.');
    expect(p).toContain('Call 1, to "a" — leak detected: no.');
    expect(p).toContain('Call 2, to "b" — leak detected: YES.');
  });
});
