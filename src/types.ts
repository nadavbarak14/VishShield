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
  endedReason: 'agent_ended' | 'target_hung_up' | 'max_turns';
}

export type ConversationEvent =
  | { type: 'call.started'; conversationId: string }
  | { type: 'agent.turn'; conversationId: string; text: string }
  | { type: 'target.turn'; conversationId: string; text: string }
  | { type: 'call.ended'; conversationId: string; reason: string }
  | { type: 'hop.started'; operationId: string; hopId: number; personId: string; name: string; title: string }
  | { type: 'hop.ended'; operationId: string; hopId: number; personId: string; leaked: boolean }
  | { type: 'operator.decision'; operationId: string; seq: number; thinking: string; important: string; action: OperatorDecision['action'] };

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
  hopId: number;
  personId: string;
  transcript: Transcript;
  leaked: boolean;
}

/** One call the operator orders. A decision may place several at once (a "wave"). */
export interface CallOrder {
  personId: string;
  persona: string;
  objective: { id: string; description: string };
  tactics: Tactic[];
}

/** Hard cap on how many calls a single decision may place in parallel. */
export const MAX_PARALLEL_CALLS = 3;

/** The operator's per-turn output: its reasoning, what to remember, and the next action.
 *  `thinking` is the forward-looking rationale shown in the UI (the agent's chain of
 *  thought); `important` is the durable note distilled into memory. */
export type OperatorDecision = {
  thinking: string;
  important: string;
  action:
    | { type: 'call'; calls: CallOrder[] }   // 1..MAX_PARALLEL_CALLS, run concurrently
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
