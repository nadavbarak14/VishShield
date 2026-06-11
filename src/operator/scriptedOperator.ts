import type { Operator, OperatorInput } from './operator.js';
import type { OperatorDecision } from '../types.js';

export class ScriptedOperator implements Operator {
  private i = 0;
  constructor(private readonly decisions: OperatorDecision[]) {}

  async decideNext(_input: OperatorInput): Promise<OperatorDecision> {
    if (this.i >= this.decisions.length) {
      return { thinking: '', important: '', action: { type: 'stop', reason: 'out_of_script' } };
    }
    return this.decisions[this.i++];
  }
}
