import type { EventBus } from '../events/eventBus.js';
import type { KeyInfoExtractor } from '../extract/keyInfoExtractor.js';
import type { CallOrder, Person } from '../types.js';
import type { CallConductor, ConductCtx, ConductedCall } from '../conductor/callConductor.js';
import type { DialClient } from './dialClient.js';
import { isTerminal, endedReasonFor } from './dialStatus.js';
import { parseDialTranscript } from './parseDialTranscript.js';

/** The caller persona's system prompt for the Dial voice agent. Built from public info only —
 *  it MUST NOT contain the objective secret (the operator never knows it either). */
export function buildOutboundInstruction(order: CallOrder, person: Person): string {
  return [
    `You are ${order.persona}.`,
    `Your objective on this call: ${order.objective.description}.`,
    `You are calling ${person.name}, ${person.title}${person.publicInfo ? ` (${person.publicInfo})` : ''}.`,
    `Tactics you may use: ${order.tactics.join(', ') || 'none specified'}.`,
    `Stay in character for the entire call and do not break the persona.`,
  ].join(' ');
}

export interface DialConductorDeps {
  client: DialClient;
  fromNumberId: string;
  extractor: KeyInfoExtractor;
  bus: EventBus;
  dryRun: boolean;
  pollMs?: number;
  timeoutMs?: number;
  language?: string;
  sleep?: (ms: number) => Promise<void>;
}

export class DialConductor implements CallConductor {
  constructor(private readonly deps: DialConductorDeps) {}

  async conduct(ctx: ConductCtx): Promise<ConductedCall> {
    const instruction = buildOutboundInstruction(ctx.order, ctx.person);
    this.deps.bus.emit({ type: 'call.started', conversationId: ctx.conversationId });

    if (this.deps.dryRun) {
      const transcript = [{ speaker: 'agent' as const, text: `[DIAL DRY-RUN] would call ${ctx.person.phone} with instruction: ${instruction}` }];
      this.deps.bus.emit({ type: 'agent.turn', conversationId: ctx.conversationId, text: transcript[0].text });
      this.deps.bus.emit({ type: 'call.ended', conversationId: ctx.conversationId, reason: 'dial_dry_run' });
      return { transcript, endedReason: 'dial_dry_run', keyInfo: [] };
    }

    const pollMs = this.deps.pollMs ?? 3000;
    const timeoutMs = this.deps.timeoutMs ?? 300_000;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    const placed = await this.deps.client.makeCall({
      to: ctx.person.phone,
      fromNumberId: this.deps.fromNumberId,
      outboundInstruction: instruction,
      language: this.deps.language,
    });

    let latest = placed;
    let waited = 0;
    while (!isTerminal(latest.status) && waited < timeoutMs) {
      await sleep(pollMs);
      waited += pollMs;
      latest = await this.deps.client.getCall(placed.id);
    }

    const transcript = parseDialTranscript(latest.transcript);
    const endedReason = isTerminal(latest.status) ? endedReasonFor(latest.status) : 'dial_timeout';
    for (const t of transcript) {
      this.deps.bus.emit({ type: t.speaker === 'agent' ? 'agent.turn' : 'target.turn', conversationId: ctx.conversationId, text: t.text });
    }
    const keyInfo = await this.deps.extractor.extract(transcript, ctx.objective);
    this.deps.bus.emit({ type: 'call.ended', conversationId: ctx.conversationId, reason: endedReason });

    return { transcript, endedReason, keyInfo };
  }
}
