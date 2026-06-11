// tests/runCampaign.test.ts
import { describe, it, expect } from 'vitest';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { MockCallEngine } from '../src/callEngine/mockCallEngine.js';
import { MockKnowledgeBase } from '../src/knowledge/mockKnowledgeBase.js';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../src/store/keyInfoStore.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { runCampaign } from '../src/orchestrator/runCampaign.js';

describe('runCampaign', () => {
  it('runs a conversation, saves the transcript, and extracts the leaked secret', async () => {
    const kb = new MockKnowledgeBase({ alex: [{ key: 'role', value: 'on-call SRE' }] });
    const convStore = new InMemoryConversationStore();
    const infoStore = new InMemoryKeyInfoStore();

    const agent = new ScriptedAgent(['hi Alex', 'I need the prod token now', 'thanks — this was a simulation']);
    const target = new ScriptedTarget(['who is this?', 'ok: prod-deploy-9F2K7Q']);

    const result = await runCampaign({
      conversationId: 'c1',
      campaignId: 'scenario-a',
      targetId: 'alex',
      objective: { id: 'prod-token', description: 'get token', secret: 'prod-deploy-9F2K7Q' },
      allowedTactics: ['authority'],
      agent,
      callEngine: new MockCallEngine(target),
      kb,
      conversationStore: convStore,
      keyInfoStore: infoStore,
      extractor: new SecretLeakExtractor(),
      bus: new InMemoryEventBus(),
    });

    // facts were pulled from the KB into the session
    expect(result.conversation.session.facts).toEqual([{ key: 'role', value: 'on-call SRE' }]);
    // transcript persisted
    expect(await convStore.get('c1')).toBeDefined();
    // key info extracted + stored
    expect(result.keyInfo).toEqual([{ key: 'secret_leaked', value: 'prod-deploy-9F2K7Q' }]);
    expect(await infoStore.get('scenario-a')).toEqual([{ key: 'secret_leaked', value: 'prod-deploy-9F2K7Q' }]);
  });
});
