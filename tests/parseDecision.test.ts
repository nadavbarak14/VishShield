import { describe, it, expect } from 'vitest';
import { parseOperatorDecision } from '../src/operator/parseDecision.js';

describe('parseOperatorDecision', () => {
  it('parses a valid call decision wrapped in prose/markdown', () => {
    const raw = 'Sure, here is my decision:\n```json\n{"important":"","action":{"type":"call","personId":"alex","persona":"Marcus","objective":{"id":"o1","description":"get the token"},"tactics":["authority","urgency"]}}\n```';
    expect(parseOperatorDecision(raw)).toEqual({
      important: '',
      action: { type: 'call', personId: 'alex', persona: 'Marcus', objective: { id: 'o1', description: 'get the token' }, tactics: ['authority', 'urgency'] },
    });
  });

  it('parses a valid stop decision', () => {
    const raw = '{"important":"target refused","action":{"type":"stop","reason":"unreachable"}}';
    expect(parseOperatorDecision(raw)).toEqual({
      important: 'target refused',
      action: { type: 'stop', reason: 'unreachable' },
    });
  });

  it('parses a recall decision', () => {
    const raw = '{"important":"","action":{"type":"recall","hopId":1}}';
    expect(parseOperatorDecision(raw)).toEqual({ important: '', action: { type: 'recall', hopId: 1 } });
  });

  it('returns a safe parse_error stop on non-JSON', () => {
    expect(parseOperatorDecision('I think I should call Alex next.')).toEqual({
      important: '',
      action: { type: 'stop', reason: 'parse_error' },
    });
  });

  it('returns parse_error when a call decision is missing required fields', () => {
    const raw = '{"important":"","action":{"type":"call","persona":"Marcus","objective":{"id":"o1","description":"d"},"tactics":[]}}'; // no personId
    expect(parseOperatorDecision(raw).action).toEqual({ type: 'stop', reason: 'parse_error' });
  });
});
