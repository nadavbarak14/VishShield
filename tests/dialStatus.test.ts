import { describe, it, expect } from 'vitest';
import { isTerminal, endedReasonFor } from '../src/dial/dialStatus.js';

describe('dialStatus', () => {
  it('treats completed/ended/failed/no-answer/busy/canceled as terminal', () => {
    for (const s of ['completed', 'ended', 'failed', 'no-answer', 'busy', 'canceled', 'cancelled']) {
      expect(isTerminal(s)).toBe(true);
    }
  });

  it('treats in-progress states AND unknown states as non-terminal', () => {
    for (const s of ['initiated', 'ringing', 'in-progress', 'queued', 'something-new']) {
      expect(isTerminal(s)).toBe(false);
    }
  });

  it('maps completed/ended to "completed" and passes other terminal statuses through', () => {
    expect(endedReasonFor('completed')).toBe('completed');
    expect(endedReasonFor('ended')).toBe('completed');
    expect(endedReasonFor('no-answer')).toBe('no-answer');
  });
});
