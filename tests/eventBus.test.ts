// tests/eventBus.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryEventBus } from '../src/events/eventBus.js';

describe('InMemoryEventBus', () => {
  it('delivers emitted events to all subscribers', () => {
    const bus = new InMemoryEventBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe((e) => a.push(e.type));
    bus.subscribe((e) => b.push(e.type));
    bus.emit({ type: 'call.started', conversationId: 'c1' });
    bus.emit({ type: 'call.ended', conversationId: 'c1', reason: 'agent_ended' });
    expect(a).toEqual(['call.started', 'call.ended']);
    expect(b).toEqual(['call.started', 'call.ended']);
  });
});
