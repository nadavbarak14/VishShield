import type { Operator, OperatorInput } from './operator.js';
import type { OperatorDecision, Person } from '../types.js';
import { runClaude, OPERATOR_MODEL } from '../claude/runClaude.js';
import { parseOperatorDecision } from './parseDecision.js';
import { SYSTEM, buildOperatorPrompt } from './operatorPrompt.js';

/** The live operator: ONE logical agent realized as a fresh `claude -p` call per decision.
 *  Memory = its own accumulated distilled notes, re-fed into each call. No `--resume`.
 *  Can `recall` a past call's full transcript on demand when its notes are not enough. */
export class ClaudeOperator implements Operator {
  private notes: string[] = [];

  constructor(private readonly goal: string, private readonly roster: Person[]) {}

  async decideNext(input: OperatorInput): Promise<OperatorDecision> {
    const prompt = buildOperatorPrompt(this.goal, this.roster, this.notes, input);
    const raw = await runClaude(SYSTEM, prompt, OPERATOR_MODEL);
    const decision = parseOperatorDecision(raw);
    if (decision.important) this.notes.push(decision.important);
    return decision;
  }
}
