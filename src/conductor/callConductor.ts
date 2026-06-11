import type { CallOrder, Fact, Objective, Person, Turn } from '../types.js';

/** Result of conducting one ordered call. `keyInfo` is the leak verdict
 *  (runOperation reads `keyInfo.length > 0` as `leaked`). `endedReason` is a free string
 *  so backends can report outcomes outside the simulated union (e.g. 'dial_timeout'). */
export interface ConductedCall {
  transcript: Turn[];
  endedReason: string;
  keyInfo: Fact[];
}

/** Everything a conductor needs for one call that varies per hop. Stable collaborators
 *  (stores, bus, factories, client) are injected at conductor construction instead. */
export interface ConductCtx {
  order: CallOrder;
  person: Person;
  objective: Objective;   // includes the fixture secret (used only for leak scoring)
  hopId: number;
  conversationId: string; // `${operationId}-hop-${hopId}`
  campaignId: string;     // = operationId
}

export interface CallConductor {
  conduct(ctx: ConductCtx): Promise<ConductedCall>;
}
