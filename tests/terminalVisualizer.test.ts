// tests/terminalVisualizer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { attachTerminalVisualizer } from '../src/visualizer/terminalVisualizer.js';

describe('terminalVisualizer', () => {
  it('prints a readable line for each event', () => {
    const bus = new InMemoryEventBus();
    const lines: string[] = [];
    const log = vi.fn((s: string) => lines.push(s));
    attachTerminalVisualizer(bus, log);

    bus.emit({ type: 'call.started', conversationId: 'c1' });
    bus.emit({ type: 'agent.turn', conversationId: 'c1', text: 'hello' });
    bus.emit({ type: 'target.turn', conversationId: 'c1', text: 'who is this?' });
    bus.emit({ type: 'call.ended', conversationId: 'c1', reason: 'agent_ended' });

    expect(lines).toEqual([
      '— call started (c1) —',
      'AGENT:  hello',
      'TARGET: who is this?',
      '— call ended (agent_ended) —',
    ]);
  });
});
