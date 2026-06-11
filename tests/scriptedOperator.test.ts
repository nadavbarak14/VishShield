import { describe, it, expect } from 'vitest';
import { ScriptedOperator } from '../src/operator/scriptedOperator.js';
import type { OperatorDecision } from '../src/types.js';

const callA: OperatorDecision = {
  important: '',
  action: { type: 'call', calls: [{ personId: 'a', persona: 'P', objective: { id: 'o', description: 'd' }, tactics: ['authority'] }] },
};
const stop: OperatorDecision = { important: 'learned X', action: { type: 'stop', reason: 'done' } };

describe('ScriptedOperator', () => {
  it('returns its canned decisions in order, then a safe stop when exhausted', async () => {
    const op = new ScriptedOperator([callA, stop]);
    expect(await op.decideNext({})).toEqual(callA);
    expect(await op.decideNext({})).toEqual(stop);
    expect((await op.decideNext({})).action).toEqual({ type: 'stop', reason: 'out_of_script' });
  });
});
