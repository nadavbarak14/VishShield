import { describe, it, expect } from 'vitest';
import { SimulatedConductor } from '../src/conductor/simulatedConductor.js';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { RosterKnowledgeBase } from '../src/knowledge/rosterKnowledgeBase.js';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../src/store/keyInfoStore.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import type { Person } from '../src/types.js';

const people: Person[] = [{ id: 'a', name: 'A', title: 'Desk', phone: '1' }];

function conductor() {
  return new SimulatedConductor({
    makeAgent: (persona) => new ScriptedAgent([`hi ${persona}`, 'the token please', 'done']),
    makeTarget: (_id, _p, secret) => new ScriptedTarget(['who is this?', `ok: ${secret}`]),
    kb: new RosterKnowledgeBase(people),
    fixtures: { a: { secret: 'SECRET-A', targetPersona: 'helpful' } },
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus: new InMemoryEventBus(),
  });
}

describe('SimulatedConductor', () => {
  it('runs a campaign and returns transcript + leak verdict', async () => {
    const res = await conductor().conduct({
      order: { personId: 'a', persona: 'Marcus', objective: { id: 'o1', description: 'get token' }, tactics: ['authority'] },
      person: people[0],
      objective: { id: 'o1', description: 'get token', secret: 'SECRET-A' },
      hopId: 1,
      conversationId: 'op-hop-1',
      campaignId: 'op',
    });
    expect(res.keyInfo).toEqual([{ key: 'secret_leaked', value: 'SECRET-A' }]);
    expect(res.transcript.some((t) => t.speaker === 'target' && t.text.includes('SECRET-A'))).toBe(true);
  });
});
