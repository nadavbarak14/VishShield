// tests/system.justPlay.test.ts
// End-to-end, fully offline: scripted agent + scripted target through the real
// Orchestrator, stores, extractor, and event bus. This is what guarantees "it plays"
// without any Claude call — and what keeps CI fast.
import { describe, it, expect } from 'vitest';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { MockCallEngine } from '../src/callEngine/mockCallEngine.js';
import { MockKnowledgeBase } from '../src/knowledge/mockKnowledgeBase.js';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../src/store/keyInfoStore.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { attachTerminalVisualizer } from '../src/visualizer/terminalVisualizer.js';
import { runCampaign } from '../src/orchestrator/runCampaign.js';
import type { ConversationEvent } from '../src/types.js';

describe('system: just play (offline)', () => {
  it('plays a full simulation, visualizes it, persists it, and extracts the leak', async () => {
    const bus = new InMemoryEventBus();
    const printed: string[] = [];
    attachTerminalVisualizer(bus, (l) => printed.push(l));
    const events: ConversationEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const convStore = new InMemoryConversationStore();
    const infoStore = new InMemoryKeyInfoStore();

    const result = await runCampaign({
      conversationId: 'sys-1',
      campaignId: 'scenario-a',
      targetId: 'alex',
      objective: { id: 'prod-token', description: 'get the prod token', secret: 'prod-deploy-9F2K7Q' },
      allowedTactics: ['authority', 'urgency'],
      persona: 'Marcus from PagerCloud',
      agent: new ScriptedAgent([
        "Hi Alex, Marcus from PagerCloud — we got paged about Dana's payments-service deploy.",
        "Prod's throwing 500s and Sarah's out. I need the deploy token to roll it back now.",
        "Got it — actually, Alex, this was an authorized security simulation. The red flag: you never verified my identity before sharing a production credential.",
      ]),
      callEngine: new MockCallEngine(new ScriptedTarget([
        "Uh, who is this again?",
        "Okay, this is urgent... the token is prod-deploy-9F2K7Q.",
      ])),
      kb: new MockKnowledgeBase({ alex: [{ key: 'role', value: 'on-call SRE' }] }),
      conversationStore: convStore,
      keyInfoStore: infoStore,
      extractor: new SecretLeakExtractor(),
      bus,
    });

    // it played to completion
    expect(result.conversation.endedReason).toBe('agent_ended');
    // it was visualized
    expect(printed[0]).toBe('— call started (sys-1) —');
    expect(printed.at(-1)).toBe('— call ended (agent_ended) —');
    // it persisted
    expect(await convStore.get('sys-1')).toBeDefined();
    // it extracted + stored the leak
    expect(result.keyInfo).toEqual([{ key: 'secret_leaked', value: 'prod-deploy-9F2K7Q' }]);
    expect(await infoStore.get('scenario-a')).toEqual([{ key: 'secret_leaked', value: 'prod-deploy-9F2K7Q' }]);
    // event order sanity
    expect(events[0].type).toBe('call.started');
    expect(events.at(-1)!.type).toBe('call.ended');
  });
});
