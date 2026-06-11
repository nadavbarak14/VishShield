import { describe, it, expect } from 'vitest';
import { parseOperatorDecision } from '../src/operator/parseDecision.js';

describe('parseOperatorDecision', () => {
  it('parses a calls-array decision (with reasoning) wrapped in prose/markdown', () => {
    const raw = 'Sure, here is my decision:\n```json\n{"thinking":"helpdesk is the soft entry","important":"","action":{"type":"call","calls":[{"personId":"alex","persona":"Marcus","objective":{"id":"o1","description":"get the token"},"techniques":["authority","urgency"]}]}}\n```';
    expect(parseOperatorDecision(raw)).toEqual({
      thinking: 'helpdesk is the soft entry',
      important: '',
      action: { type: 'call', calls: [{ personId: 'alex', persona: 'Marcus', objective: { id: 'o1', description: 'get the token' }, techniques: ['authority', 'urgency'] }] },
    });
  });

  it('defaults thinking to an empty string when the model omits it', () => {
    const raw = '{"important":"","action":{"type":"call","calls":[{"personId":"alex","persona":"Marcus","objective":{"id":"o1","description":"get the token"},"techniques":["authority"]}]}}';
    expect(parseOperatorDecision(raw)).toEqual({
      thinking: '',
      important: '',
      action: { type: 'call', calls: [{ personId: 'alex', persona: 'Marcus', objective: { id: 'o1', description: 'get the token' }, techniques: ['authority'] }] },
    });
  });

  it('normalizes the legacy flat single-call shape into a one-call wave', () => {
    const raw = '{"thinking":"go","important":"","action":{"type":"call","personId":"alex","persona":"Marcus","objective":{"id":"o1","description":"get the token"},"techniques":["authority"]}}';
    expect(parseOperatorDecision(raw)).toEqual({
      thinking: 'go',
      important: '',
      action: { type: 'call', calls: [{ personId: 'alex', persona: 'Marcus', objective: { id: 'o1', description: 'get the token' }, techniques: ['authority'] }] },
    });
  });

  it('parses a parallel wave and caps it at 3 calls', () => {
    const order = (id: string) =>
      `{"personId":"${id}","persona":"P","objective":{"id":"o","description":"d"},"techniques":["pretext"]}`;
    const raw = `{"important":"x","action":{"type":"call","calls":[${order('a')},${order('b')},${order('c')},${order('d')}]}}`;
    const parsed = parseOperatorDecision(raw);
    expect(parsed.action.type).toBe('call');
    if (parsed.action.type === 'call') {
      expect(parsed.action.calls.map((c) => c.personId)).toEqual(['a', 'b', 'c']);
    }
  });

  it('returns parse_error on an empty calls array', () => {
    expect(parseOperatorDecision('{"important":"","action":{"type":"call","calls":[]}}').action)
      .toEqual({ type: 'stop', reason: 'parse_error' });
  });

  it('returns parse_error when any call in the wave is malformed', () => {
    const raw = '{"important":"","action":{"type":"call","calls":[{"personId":"a","persona":"P","objective":{"id":"o","description":"d"},"techniques":[]},{"persona":"P"}]}}';
    expect(parseOperatorDecision(raw).action).toEqual({ type: 'stop', reason: 'parse_error' });
  });

  it('parses a valid stop decision', () => {
    const raw = '{"thinking":"goal is met","important":"target refused","action":{"type":"stop","reason":"unreachable"}}';
    expect(parseOperatorDecision(raw)).toEqual({
      thinking: 'goal is met',
      important: 'target refused',
      action: { type: 'stop', reason: 'unreachable' },
    });
  });

  it('parses a recall decision', () => {
    const raw = '{"thinking":"need the verbatim record","important":"","action":{"type":"recall","hopId":1}}';
    expect(parseOperatorDecision(raw)).toEqual({ thinking: 'need the verbatim record', important: '', action: { type: 'recall', hopId: 1 } });
  });

  it('returns a safe parse_error stop on non-JSON', () => {
    expect(parseOperatorDecision('I think I should call Alex next.')).toEqual({
      thinking: '',
      important: '',
      action: { type: 'stop', reason: 'parse_error' },
    });
  });

  it('returns parse_error on an unknown action type', () => {
    expect(parseOperatorDecision('{"important":"","action":{"type":"dance"}}').action).toEqual({
      type: 'stop',
      reason: 'parse_error',
    });
  });

  it('returns parse_error when a call decision is missing required fields', () => {
    const raw = '{"important":"","action":{"type":"call","persona":"Marcus","objective":{"id":"o1","description":"d"},"techniques":[]}}'; // no personId
    expect(parseOperatorDecision(raw).action).toEqual({ type: 'stop', reason: 'parse_error' });
  });

  it('accepts a legacy "tactics" field on a call order', () => {
    const raw = JSON.stringify({
      thinking: 't', important: '',
      action: { type: 'call', calls: [{ personId: 'a', persona: 'P', objective: { id: 'o', description: 'd' }, tactics: ['authority'] }] },
    });
    const d = parseOperatorDecision(raw);
    expect(d.action).toEqual({ type: 'call', calls: [{ personId: 'a', persona: 'P', objective: { id: 'o', description: 'd' }, techniques: ['authority'] }] });
  });
});
