import { describe, it, expect } from 'vitest';
import { parseDialTranscript } from '../src/dial/parseDialTranscript.js';

describe('parseDialTranscript', () => {
  it('returns [] for null/empty', () => {
    expect(parseDialTranscript(null)).toEqual([]);
    expect(parseDialTranscript('')).toEqual([]);
  });

  it('maps speaker-labelled lines to agent/target turns', () => {
    const raw = 'AGENT: hello there\nUSER: who is this?\nAGENT: it is Marcus';
    expect(parseDialTranscript(raw)).toEqual([
      { speaker: 'agent', text: 'hello there' },
      { speaker: 'target', text: 'who is this?' },
      { speaker: 'agent', text: 'it is Marcus' },
    ]);
  });

  it('appends unlabelled continuation lines to the previous turn', () => {
    const raw = 'AGENT: hello\nthere again\nTARGET: hi';
    expect(parseDialTranscript(raw)).toEqual([
      { speaker: 'agent', text: 'hello there again' },
      { speaker: 'target', text: 'hi' },
    ]);
  });

  it('falls back to a single agent turn when there are no labels', () => {
    expect(parseDialTranscript('just some prose')).toEqual([{ speaker: 'agent', text: 'just some prose' }]);
  });
});
