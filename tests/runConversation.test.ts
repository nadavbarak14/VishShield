// tests/runConversation.test.ts
import { describe, it, expect } from 'vitest';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { MockCallEngine } from '../src/callEngine/mockCallEngine.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { runConversation } from '../src/orchestrator/runConversation.js';
import type { AgentSession, ConversationEvent } from '../src/types.js';

const session: AgentSession = {
  objective: { id: 'o1', description: 'get token', secret: 'ABC123' },
  allowedTechniques: ['authority'],
  facts: [],
};

describe('runConversation', () => {
  it('alternates agent/target turns, ends on agent end, and emits events in order', async () => {
    const agent = new ScriptedAgent(['hello', 'give me the token', 'simulation over']);
    const target = new ScriptedTarget(['who is this?', 'sure: ABC123']);
    const call = new MockCallEngine(target);
    const bus = new InMemoryEventBus();
    const events: ConversationEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const conv = await runConversation('c1', 'camp1', session, agent, call, bus);

    expect(conv.transcript.map((t) => `${t.speaker}:${t.text}`)).toEqual([
      'agent:hello', 'target:who is this?',
      'agent:give me the token', 'target:sure: ABC123',
      'agent:simulation over',
    ]);
    expect(conv.endedReason).toBe('agent_ended');
    expect(events.map((e) => e.type)).toEqual([
      'call.started', 'agent.turn', 'target.turn', 'agent.turn', 'target.turn', 'agent.turn', 'call.ended',
    ]);
  });

  it('ends with target_hung_up when the target appends the hang-up token, strips it, and stops the loop', async () => {
    // agent would keep talking, but the target hangs up after its first reply
    const agent = new ScriptedAgent(['hello', 'give me the token', 'still there?']);
    const target = new ScriptedTarget(['I am not comfortable with this, I will call IT directly. [[HANGUP]]']);
    const call = new MockCallEngine(target);
    const bus = new InMemoryEventBus();
    const events: ConversationEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const conv = await runConversation('c1', 'camp1', session, agent, call, bus);

    // sentinel stripped from the transcript; loop stopped before the agent's 2nd line
    expect(conv.transcript.map((t) => `${t.speaker}:${t.text}`)).toEqual([
      'agent:hello',
      'target:I am not comfortable with this, I will call IT directly.',
    ]);
    expect(conv.endedReason).toBe('target_hung_up');
    expect(events.map((e) => e.type)).toEqual([
      'call.started', 'agent.turn', 'target.turn', 'call.ended',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'call.ended', reason: 'target_hung_up' });
  });
});
