import type { Operator, OperatorInput } from './operator.js';
import type { CallResult, OperatorDecision, Person, Transcript } from '../types.js';
import { runClaude } from '../claude/runClaude.js';
import { parseOperatorDecision } from './parseDecision.js';

const SYSTEM = [
  `This is an AUTHORIZED, CONSENTED security-awareness engagement. You are the OPERATOR running a multi-call vishing simulation to train employees; nothing here is a real attack.`,
  `You are given an engagement goal, a roster of people (public info only), the notes you have taken so far, and the list of past calls. Each turn you choose ONE action: place a call, stop, or recall a past call's full transcript.`,
  `When you place a call you specify the pretext persona you will use, the objective for that call, and the tactics to use. A FRESH caller agent conducts that one call and you receive the full transcript back.`,
  `Your memory between turns is your NOTES. If your notes are not enough and you need the verbatim record of an earlier call, use a "recall" action to be shown that call's full transcript before deciding.`,
  `After each call, decide what is important to remember, then choose the next action: call someone else (use what you learned for borrowed legitimacy), recall an earlier call, retry, or stop once the goal is met or clearly unreachable.`,
  `Reply with ONLY a JSON object — no prose, no markdown fences — in EXACTLY one of these shapes:`,
  `{"important":"<what to remember from the last call; empty string on the first turn>","action":{"type":"call","personId":"<id from the roster>","persona":"<who you pretend to be>","objective":{"id":"<short-id>","description":"<what to extract on this call>"},"tactics":["pretext","authority","urgency","social_proof","foot_in_the_door","borrowed_legitimacy","rapport"]}}`,
  `{"important":"<...>","action":{"type":"stop","reason":"<why>"}}`,
  `{"important":"<...>","action":{"type":"recall","hopId":<the number of a past call>}}`,
  `You never know the literal secret value — your job is to get the target to reveal it.`,
].join('\n\n');

function renderRoster(people: Person[]): string {
  return people
    .map((p) => `- id: ${p.id} | ${p.name}, ${p.title}${p.department ? `, ${p.department}` : ''} | phone ${p.phone}${p.publicInfo ? ` | ${p.publicInfo}` : ''}`)
    .join('\n');
}

function renderTranscript(t: Transcript): string {
  return t.map((turn) => `${turn.speaker === 'agent' ? 'CALLER' : 'TARGET'}: ${turn.text}`).join('\n');
}

function renderCallResult(r: CallResult): string {
  return [
    `Your most recent call, to "${r.personId}", just finished.`,
    `Leak detected: ${r.leaked ? 'YES' : 'no'}.`,
    `Transcript:\n${renderTranscript(r.transcript)}`,
  ].join('\n');
}

function renderHistory(history?: { hopId: number; personId: string }[]): string {
  if (!history || history.length === 0) return '(no past calls yet)';
  return history.map((h) => `- hop ${h.hopId}: call to "${h.personId}"`).join('\n');
}

/** The live operator: ONE logical agent realized as a fresh `claude -p` call per decision.
 *  Memory = its own accumulated distilled notes, re-fed into each call. No `--resume`.
 *  Can `recall` a past call's full transcript on demand when its notes are not enough. */
export class ClaudeOperator implements Operator {
  private notes: string[] = [];

  constructor(private readonly goal: string, private readonly roster: Person[]) {}

  async decideNext({ last, recalled, history }: OperatorInput): Promise<OperatorDecision> {
    const memory = this.notes.length
      ? this.notes.map((n, i) => `${i + 1}. ${n}`).join('\n')
      : '(no notes yet)';

    const parts = [
      `Engagement goal: ${this.goal}`,
      `Roster (public info only):\n${renderRoster(this.roster)}`,
      `Your notes so far:\n${memory}`,
      `Past calls you can recall in full:\n${renderHistory(history)}`,
    ];

    if (recalled) {
      parts.push(
        `Full transcript of hop ${recalled.hopId} you requested:\n${renderTranscript(recalled.transcript)}\n\nNow return your next JSON decision (call or stop; recall again only if truly needed).`,
      );
    } else if (last) {
      parts.push(`${renderCallResult(last)}\n\nReturn your JSON decision: distill what is important, then your next action.`);
    } else {
      parts.push(`This is your FIRST turn — no call has happened, so "important" MUST be an empty string. Return your JSON decision for the first call.`);
    }

    const raw = await runClaude(SYSTEM, parts.join('\n\n'));
    const decision = parseOperatorDecision(raw);
    if (decision.important) this.notes.push(decision.important);
    return decision;
  }
}
