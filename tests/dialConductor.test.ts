import { describe, it, expect, vi } from 'vitest';
import { DialConductor, buildOutboundInstruction } from '../src/dial/dialConductor.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import type { ConductCtx } from '../src/conductor/callConductor.js';
import type { Person } from '../src/types.js';

const person: Person = { id: 'a', name: 'Alex Doe', title: 'Service Desk', phone: '+15551234', publicInfo: 'on LinkedIn' };
const ctx: ConductCtx = {
  order: { personId: 'a', persona: 'Marcus from IT', objective: { id: 'o1', description: 'get the VPN code' }, tactics: ['authority', 'urgency'] },
  person,
  objective: { id: 'o1', description: 'get the VPN code', secret: 'VPN-9000' },
  hopId: 1,
  conversationId: 'op-hop-1',
  campaignId: 'op',
};

describe('buildOutboundInstruction', () => {
  it('includes persona, objective, person, tactics — and never the secret', () => {
    const inst = buildOutboundInstruction(ctx.order, person);
    expect(inst).toContain('Marcus from IT');
    expect(inst).toContain('get the VPN code');
    expect(inst).toContain('Alex Doe');
    expect(inst).toContain('authority');
    expect(inst).not.toContain('VPN-9000');
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
});
