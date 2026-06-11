import type { Agent } from '../agent/agent.js';
import type { Target } from '../target/target.js';
import type { CallEngine } from '../callEngine/callEngine.js';
import type { KnowledgeBase } from '../knowledge/knowledgeBase.js';
import type { ConversationStore } from '../store/conversationStore.js';
import type { KeyInfoStore } from '../store/keyInfoStore.js';
import type { KeyInfoExtractor } from '../extract/keyInfoExtractor.js';
import type { EventBus } from '../events/eventBus.js';
import { MockCallEngine } from '../callEngine/mockCallEngine.js';
import { runCampaign } from '../orchestrator/runCampaign.js';
import type { CallConductor, ConductCtx, ConductedCall } from './callConductor.js';

export interface SimulatedConductorDeps {
  makeAgent: (persona: string, personId?: string) => Agent;
  makeTarget: (personId: string, persona: string, secret?: string) => Target;
  makeCallEngine?: (target: Target) => CallEngine;
  kb: KnowledgeBase;
  fixtures: Record<string, { secret?: string; targetPersona: string }>;
  conversationStore: ConversationStore;
  keyInfoStore: KeyInfoStore;
  extractor: KeyInfoExtractor;
  bus: EventBus;
}

export class SimulatedConductor implements CallConductor {
  private readonly makeCallEngine: (target: Target) => CallEngine;
  constructor(private readonly deps: SimulatedConductorDeps) {
    this.makeCallEngine = deps.makeCallEngine ?? ((t) => new MockCallEngine(t));
  }

  async conduct(ctx: ConductCtx): Promise<ConductedCall> {
    const { order, objective, conversationId, campaignId } = ctx;
    // Synchronous prefix (factory calls) — preserves runOperation's array-order determinism.
    const agent = this.deps.makeAgent(order.persona, order.personId);
    const target = this.deps.makeTarget(order.personId, this.deps.fixtures[order.personId]?.targetPersona ?? '', objective.secret);
    const callEngine = this.makeCallEngine(target);

    const { conversation, keyInfo } = await runCampaign({
      conversationId,
      campaignId,
      targetId: order.personId,
      objective,
      allowedTactics: order.tactics,
      persona: order.persona,
      agent,
      callEngine,
      kb: this.deps.kb,
      conversationStore: this.deps.conversationStore,
      keyInfoStore: this.deps.keyInfoStore,
      extractor: this.deps.extractor,
      bus: this.deps.bus,
    });

    return { transcript: conversation.transcript, endedReason: conversation.endedReason, keyInfo };
  }
}
