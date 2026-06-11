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
  | { type: 'call.ended'; conversationId: string; reason: Conversation['endedReason'] }
  | { type: 'hop.started'; operationId: string; hopId: number; personId: string; name: string; title: string }
  | { type: 'hop.ended'; operationId: string; hopId: number; personId: string; leaked: boolean }
  | { type: 'operator.decision'; operationId: string; seq: number; important: string; action: OperatorDecision['action'] };

/** Public profile of a person in the roster. The attacker side sees ONLY this — never a secret. */
export interface Person {
  id: string;
  name: string;
  title: string;
  phone: string;
  department?: string;
  publicInfo?: string;
}

/** What the operator is handed after a call it ordered (undefined on the very first turn). */
export interface CallResult {
  personId: string;
  transcript: Transcript;
  leaked: boolean;
}

/** The operator's per-turn output: what to remember from the last call, plus the next action. */
export type OperatorDecision = {
  important: string;
  action:
    | {
        type: 'call';
        personId: string;
        persona: string;
        objective: { id: string; description: string };
        tactics: Tactic[];
      }
    | { type: 'stop'; reason: string }
    | { type: 'recall'; hopId: number };   // re-read a past call's full transcript on demand
};

export interface OperationHop {
  hopId: number;
  personId: string;
  persona: string;
  objective: Objective;
  transcript: Transcript;
  endedReason: string;
  leaked: boolean;
}

export interface OperationRun {
  id: string;
  goal: string;
  hops: OperationHop[];
  keyInfo: Fact[];        // flattened across hops; read by play.ts + web
  compromised: boolean;   // any hop leaked; read by web verdict
}
