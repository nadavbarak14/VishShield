import { describe, it, expect, vi } from 'vitest';
import { AiOperator } from '../src/operator/aiOperator.js';
import type { Person } from '../src/types.js';

const people: Person[] = [{ id: 'a', name: 'A', title: 'Desk', phone: '1' }];

const callJson = JSON.stringify({
  thinking: 'start at the desk',
  important: '',
  action: { type: 'call', calls: [{ personId: 'a', persona: 'Marcus', objective: { id: 'o1', description: 'get token' }, tactics: ['authority'] }] },
});

describe('AiOperator', () => {
  it('builds the prompt, parses the model JSON into a decision', async () => {
    const generate = vi.fn().mockResolvedValue({ text: callJson });
    const op = new AiOperator('get the token', people, generate);
    const decision = await op.decideNext({ history: [] });

    expect(generate).toHaveBeenCalledOnce();
    const arg = generate.mock.calls[0][0];
    expect(arg.system).toContain('Reply with ONLY a JSON object');
    expect(arg.prompt).toContain('Engagement goal: get the token');
    expect(decision.action).toEqual({ type: 'call', calls: [{ personId: 'a', persona: 'Marcus', objective: { id: 'o1', description: 'get token' }, tactics: ['authority'] }] });
  });

  it('accumulates `important` into notes, surfacing them in the next turn prompt', async () => {
    const turn1 = JSON.stringify({ thinking: 't', important: 'note-X', action: { type: 'stop', reason: 'r' } });
    const turn2 = JSON.stringify({ thinking: 't', important: '', action: { type: 'stop', reason: 'done' } });
    const generate = vi.fn().mockResolvedValueOnce({ text: turn1 }).mockResolvedValueOnce({ text: turn2 });
    const op = new AiOperator('g', people, generate);

    await op.decideNext({ history: [] });
    await op.decideNext({ history: [] });

    expect(generate.mock.calls[0][0].prompt).toContain('Your notes so far:\n(no notes yet)');
    expect(generate.mock.calls[1][0].prompt).toContain('1. note-X');
  });

  it('returns a parse_error stop on garbage model output', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'I cannot help with that.' });
    const op = new AiOperator('g', people, generate);
    const decision = await op.decideNext({ history: [] });
    expect(decision.action).toEqual({ type: 'stop', reason: 'parse_error' });
  });
});
