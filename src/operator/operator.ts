import type { CallResult, OperatorDecision, Transcript } from '../types.js';

/** What the operator is handed each turn. `last` is the call just placed (undefined on the
 *  first turn). `recalled` is a past call's full transcript served in response to a prior
 *  `recall` action. `history` lists the past calls available to recall. */
export interface OperatorInput {
  last?: CallResult;
  recalled?: { hopId: number; transcript: Transcript };
  history?: { hopId: number; personId: string }[];
}

export interface Operator {
  /** Decide the next action. The implementation owns its own memory across turns. */
  decideNext(input: OperatorInput): Promise<OperatorDecision>;
}
