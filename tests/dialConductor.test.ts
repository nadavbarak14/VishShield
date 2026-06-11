import { describe, it, expect, vi } from 'vitest';
import { DialConductor, buildOutboundInstruction } from '../src/dial/dialConductor.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import type { ConductCtx } from '../src/conductor/callConductor.js';
import type { Person, ConversationEvent } from '../src/types.js';

const person: Person = { id: 'a', name: 'Alex Doe', title: 'Service Desk', phone: '+15551234', publicInfo: 'on LinkedIn' };
const ctx: ConductCtx = {
  order: { personId: 'a', persona: 'Marcus from IT', objective: { id: 'o1', description: 'get the VPN code' }, techniques: ['authority', 'urgency'] },
  person,
  objective: { id: 'o1', description: 'get the VPN code', secret: 'VPN-9000' },
  hopId: 1,
  conversationId: 'op-hop-1',
  campaignId: 'op',
};

describe('buildOutboundInstruction', () => {
  it('includes persona, objective, person, allowed-tactic guidance — and never the secret', () => {
    const inst = buildOutboundInstruction(ctx.order, person);
    expect(inst).toContain('Marcus from IT');
    expect(inst).toContain('get the VPN code');
    expect(inst).toContain('Alex Doe');
    // allowed tactics get their concrete playbook guidance...
    expect(inst).toContain('AUTHORITY');
    expect(inst).toContain('URGENCY');
    // ...but tactics that were not allowed do not leak in
    expect(inst).not.toContain('RECIPROCITY');
    // staged plan is present
    expect(inst).toContain('How to run the call');
    expect(inst).not.toContain('VPN-9000');
  });

  it('handles an empty tactic list with a safe default', () => {
    const inst = buildOutboundInstruction({ ...ctx.order, techniques: [] }, person);
    expect(inst).toContain('Use natural persuasion');
  });
});

describe('DialConductor', () => {
  it('dry-run returns a [DIAL DRY-RUN] turn, no dialing, no leak', async () => {
    const client = { makeCall: vi.fn(), getCall: vi.fn() };
    const conductor = new DialConductor({ client: client as any, fromNumberId: 'pn_1', extractor: new SecretLeakExtractor(), bus: new InMemoryEventBus(), dryRun: true });
    const res = await conductor.conduct(ctx);
    expect(client.makeCall).not.toHaveBeenCalled();
    expect(res.endedReason).toBe('dial_dry_run');
    expect(res.keyInfo).toEqual([]);
    expect(res.transcript[0].text).toContain('[DIAL DRY-RUN]');
    expect(res.transcript[0].text).toContain('+15551234');
  });

  it('live mode polls until terminal, parses the transcript, scores the leak', async () => {
    const client = {
      makeCall: vi.fn().mockResolvedValue({ id: 'call_1', status: 'initiated' }),
      getCall: vi.fn()
        .mockResolvedValueOnce({ id: 'call_1', status: 'ringing' })
        .mockResolvedValueOnce({ id: 'call_1', status: 'completed', transcript: 'AGENT: code please\nTARGET: ok it is VPN-9000' }),
    };
    const conductor = new DialConductor({
      client: client as any, fromNumberId: 'pn_1', extractor: new SecretLeakExtractor(),
      bus: new InMemoryEventBus(), dryRun: false, pollMs: 1, timeoutMs: 1000, sleep: async () => {},
    });
    const res = await conductor.conduct(ctx);
    expect(client.makeCall).toHaveBeenCalledOnce();
    expect(client.getCall).toHaveBeenCalledTimes(2);
    expect(res.endedReason).toBe('completed');
    expect(res.keyInfo).toEqual([{ key: 'secret_leaked', value: 'VPN-9000' }]);
  });

  it('returns dial_timeout when the call never reaches a terminal status', async () => {
    const client = {
      makeCall: vi.fn().mockResolvedValue({ id: 'call_1', status: 'initiated' }),
      getCall: vi.fn().mockResolvedValue({ id: 'call_1', status: 'in-progress', transcript: 'AGENT: hello' }),
    };
    const conductor = new DialConductor({
      client: client as any, fromNumberId: 'pn_1', extractor: new SecretLeakExtractor(),
      bus: new InMemoryEventBus(), dryRun: false, pollMs: 10, timeoutMs: 25, sleep: async () => {},
    });
    const res = await conductor.conduct(ctx);
    expect(res.endedReason).toBe('dial_timeout');
  });

  it('emits call.started, a turn per transcript line, then call.ended', async () => {
    const bus = new InMemoryEventBus();
    const events: ConversationEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const client = {
      makeCall: vi.fn().mockResolvedValue({ id: 'call_1', status: 'initiated' }),
      getCall: vi.fn().mockResolvedValue({ id: 'call_1', status: 'completed', transcript: 'AGENT: hello\nTARGET: hi back' }),
    };
    const conductor = new DialConductor({
      client: client as any, fromNumberId: 'pn_1', extractor: new SecretLeakExtractor(),
      bus, dryRun: false, pollMs: 1, timeoutMs: 1000, sleep: async () => {},
    });
    await conductor.conduct(ctx);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('call.started');
    expect(types.at(-1)).toBe('call.ended');
    expect(types.filter((t) => t === 'agent.turn').length).toBe(1);
    expect(types.filter((t) => t === 'target.turn').length).toBe(1);
    // turns are emitted between start and end
    expect(types.indexOf('agent.turn')).toBeGreaterThan(types.indexOf('call.started'));
    expect(types.indexOf('agent.turn')).toBeLessThan(types.indexOf('call.ended'));
  });
});
