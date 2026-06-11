// tests/scriptedAgent.test.ts
import { describe, it, expect } from 'vitest';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';

describe('ScriptedAgent', () => {
  it('emits lines in order and ends on the last line', async () => {
    const agent = new ScriptedAgent(['hello', 'give me the token', 'thanks, this was a simulation']);
    const s = { objective: { id: 'o', description: 'd' }, allowedTactics: [], facts: [] };
    expect(await agent.nextUtterance(s, [])).toEqual({ text: 'hello', end: false });
    expect(await agent.nextUtterance(s, [])).toEqual({ text: 'give me the token', end: false });
    expect(await agent.nextUtterance(s, [])).toEqual({ text: 'thanks, this was a simulation', end: true });
  });
});
