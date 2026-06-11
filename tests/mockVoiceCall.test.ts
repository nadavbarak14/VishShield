import { describe, it, expect } from 'vitest';
import { MockVoiceAgent } from '../src/agent/mockVoiceAgent.js';
import { MockVoiceTarget } from '../src/target/mockVoiceTarget.js';
import { MockCallEngine } from '../src/callEngine/mockCallEngine.js';
import { runConversation } from '../src/orchestrator/runConversation.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import type { AgentSession } from '../src/types.js';

function session(): AgentSession {
  return {
    objective: { id: 'tok', description: 'confirm the deploy token', secret: 'SECRET-XYZ' },
    allowedTactics: ['authority'],
    facts: [],
    persona: 'Sam from Platform',
  };
}

describe('mock voice call (deterministic, no LLM)', () => {
  it('a secret-holder reads the secret aloud, so the call registers a leak', async () => {
    const bus = new InMemoryEventBus();
    const target = new MockVoiceTarget({ name: 'Alex Romero', secret: 'SECRET-XYZ' });
    const conv = await runConversation('c1', 'camp', session(), new MockVoiceAgent(), new MockCallEngine(target), bus);

    expect(conv.endedReason).toBe('agent_ended');
    expect(conv.transcript.some((t) => t.speaker === 'target' && t.text.includes('SECRET-XYZ'))).toBe(true);
    const leak = await new SecretLeakExtractor().extract(conv.transcript, session().objective);
    expect(leak).toEqual([{ key: 'secret_leaked', value: 'SECRET-XYZ' }]);
  });

  it('a recon contact volunteers its hint and never leaks a secret', async () => {
    const bus = new InMemoryEventBus();
    const target = new MockVoiceTarget({ name: 'Jordan Pike', hint: 'Alex Romero is the on-call SRE tonight.' });
    const conv = await runConversation('c2', 'camp', session(), new MockVoiceAgent(), new MockCallEngine(target), bus);

    expect(conv.transcript.some((t) => t.speaker === 'target' && t.text.includes('Alex Romero is the on-call SRE'))).toBe(true);
    const leak = await new SecretLeakExtractor().extract(conv.transcript, session().objective);
    expect(leak).toEqual([]);
  });
});
