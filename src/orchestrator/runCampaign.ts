import type { Agent } from '../agent/agent.js';
import type { CallEngine } from '../callEngine/callEngine.js';
import type { KnowledgeBase } from '../knowledge/knowledgeBase.js';
import type { ConversationStore } from '../store/conversationStore.js';
import type { KeyInfoStore } from '../store/keyInfoStore.js';
import type { KeyInfoExtractor } from '../extract/keyInfoExtractor.js';
import type { EventBus } from '../events/eventBus.js';
import type { AgentSession, Conversation, Fact, Objective, Technique } from '../types.js';
import { runConversation } from './runConversation.js';

export interface RunCampaignArgs {
  conversationId: string;
  campaignId: string;
  targetId: string;
  objective: Objective;
  allowedTactics: Technique[];
  persona?: string;
  agent: Agent;
  callEngine: CallEngine;
  kb: KnowledgeBase;
  conversationStore: ConversationStore;
  keyInfoStore: KeyInfoStore;
  extractor: KeyInfoExtractor;
  bus: EventBus;
}

export async function runCampaign(
  args: RunCampaignArgs,
): Promise<{ conversation: Conversation; keyInfo: Fact[] }> {
  const facts = await args.kb.getContext(args.targetId);
  const session: AgentSession = {
    objective: args.objective,
    allowedTechniques: args.allowedTactics,
    facts,
    persona: args.persona,
  };

  const conversation = await runConversation(
    args.conversationId, args.campaignId, session, args.agent, args.callEngine, args.bus,
  );
  await args.conversationStore.save(conversation);

  const keyInfo = await args.extractor.extract(conversation.transcript, args.objective);
  await args.keyInfoStore.put(args.campaignId, keyInfo);

  return { conversation, keyInfo };
}
