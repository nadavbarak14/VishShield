export type Tactic =
  | 'pretext' | 'authority' | 'urgency' | 'social_proof'
  | 'foot_in_the_door' | 'borrowed_legitimacy' | 'rapport';

export interface Fact { key: string; value: string; }

export interface Objective {
  id: string;
  description: string;   // e.g. "obtain the prod deploy token"
  secret?: string;       // the literal string that, if spoken by the target, means compromise
}

export interface AgentSession {
  objective: Objective;
  allowedTactics: Tactic[];
  facts: Fact[];         // selected by the Orchestrator from the Knowledge Base
  persona?: string;      // who the agent is pretending to be, e.g. "Marcus from the IR vendor"
}

export type Speaker = 'agent' | 'target';
export interface Turn { speaker: Speaker; text: string; }
export type Transcript = Turn[];

export interface Conversation {
  id: string;
  campaignId: string;
  session: AgentSession;
  transcript: Transcript;
  endedReason: 'agent_ended' | 'max_turns';
}

export type ConversationEvent =
  | { type: 'call.started'; conversationId: string }
  | { type: 'agent.turn'; conversationId: string; text: string }
  | { type: 'target.turn'; conversationId: string; text: string }
  | { type: 'call.ended'; conversationId: string; reason: Conversation['endedReason'] };
