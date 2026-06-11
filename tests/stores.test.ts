// tests/stores.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../src/store/keyInfoStore.js';
import type { Conversation } from '../src/types.js';

const conv: Conversation = {
  id: 'c1', campaignId: 'camp1',
  session: { objective: { id: 'o', description: 'd' }, allowedTactics: [], facts: [] },
  transcript: [{ speaker: 'agent', text: 'hi' }],
  endedReason: 'agent_ended',
};

describe('stores', () => {
  it('saves and retrieves a conversation', async () => {
    const store = new InMemoryConversationStore();
    await store.save(conv);
    expect(await store.get('c1')).toEqual(conv);
  });

  it('accumulates key-info facts per campaign', async () => {
    const store = new InMemoryKeyInfoStore();
    await store.put('camp1', [{ key: 'secret_leaked', value: 'ABC123' }]);
    await store.put('camp1', [{ key: 'ticket', value: '4471' }]);
    expect(await store.get('camp1')).toEqual([
      { key: 'secret_leaked', value: 'ABC123' },
      { key: 'ticket', value: '4471' },
    ]);
  });
});
