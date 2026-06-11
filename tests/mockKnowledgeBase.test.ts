// tests/mockKnowledgeBase.test.ts
import { describe, it, expect } from 'vitest';
import { MockKnowledgeBase } from '../src/knowledge/mockKnowledgeBase.js';

describe('MockKnowledgeBase', () => {
  it('returns facts for a known target and [] for unknown', async () => {
    const kb = new MockKnowledgeBase({
      alex: [{ key: 'role', value: 'on-call SRE' }],
    });
    expect(await kb.getContext('alex')).toEqual([{ key: 'role', value: 'on-call SRE' }]);
    expect(await kb.getContext('nobody')).toEqual([]);
  });
});
