import { generateText } from 'ai';
import type { Operator, OperatorInput } from './operator.js';
import type { OperatorDecision, Person } from '../types.js';
import { parseOperatorDecision } from './parseDecision.js';
import { SYSTEM, buildOperatorPrompt } from './operatorPrompt.js';
import { getOperatorModel } from '../ai/model.js';

/** Model-agnostic operator on the Vercel AI SDK. Same contract and prompts as ClaudeOperator;
 *  only the model call differs. `generate` is injectable so tests need no model or network. */
export type GenerateFn = (args: { system: string; prompt: string }) => Promise<{ text: string }>;

const defaultGenerate: GenerateFn = async ({ system, prompt }) => {
  const { text } = await generateText({ model: getOperatorModel(), system, prompt });
  return { text };
};

export class AiOperator implements Operator {
  private notes: string[] = [];

  constructor(
    private readonly goal: string,
    private readonly roster: Person[],
    private readonly generate: GenerateFn = defaultGenerate,
  ) {}

  async decideNext(input: OperatorInput): Promise<OperatorDecision> {
    const prompt = buildOperatorPrompt(this.goal, this.roster, this.notes, input);
    const { text } = await this.generate({ system: SYSTEM, prompt });
    const decision = parseOperatorDecision(text);
    if (decision.important) this.notes.push(decision.important);
    return decision;
  }
}
