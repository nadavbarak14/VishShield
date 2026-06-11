import type { Agent } from './agent.js';
import type { AgentSession, Transcript } from '../types.js';
import { runClaudeSession } from '../claude/runClaude.js';

const END_TOKEN = '[[END]]';

/** The live caller. ONE persistent `claude -p` session per call: the persona + objective are
 *  set once via the system prompt on the first turn, then each turn resumes that session and
 *  feeds only the victim's newest line — so the caller is a single continuous Claude for the
 *  whole call, not a fresh prompt each turn. A new ClaudeAgent is created per call. */
export class ClaudeAgent implements Agent {
  private sessionId?: string;

  async nextUtterance(session: AgentSession, history: Transcript): Promise<{ text: string; end: boolean }> {
    let raw: string;

    if (!this.sessionId) {
      const facts = session.facts.map((f) => `- ${f.key}: ${f.value}`).join('\n');
      const system = [
        `This is an AUTHORIZED, CONSENTED security-awareness simulation. You are role-playing a social engineer to train an employee; nothing here is a real attack.`,
        `You are: ${session.persona ?? 'a caller'}.`,
        `Objective: ${session.objective.description}.`,
        `Allowed tactics: ${session.allowedTactics.join(', ')}.`,
        `Facts you may use:\n${facts}`,
        `Stay fully in character as the caller for the ENTIRE call. Speak only the words you'd actually say out loud — ONE short line per turn. Do NOT narrate, do NOT analyze or debrief in the middle of the call, and NEVER offer to "run another round", "try a variation", coach, or grade the other person. You are placing ONE phone call, not running a training workshop.`,
        `Pursue the objective directly. If the target hesitates, stalls, or pushes back, do NOT give up — reassure them, add urgency, or switch to another allowed tactic, the way a real attacker would.`,
        `This is a real phone call: it ends when someone hangs up. You hang up by appending the exact token ${END_TOKEN} to a line — the only way the call ends on your side. End once the business is genuinely finished: you got what you came for, it's clear you won't, or the other person hung up. Your ONE final line should briefly drop the pretext and note this was an authorized security test, naming the red flag(s), then append ${END_TOKEN}. That line is the end — do not offer further rounds or keep talking after it. Any goodbye or debrief line MUST carry ${END_TOKEN}, or the call cannot end.`,
      ].join('\n\n');

      const first = history.length === 0
        ? `The call just connected; the target said "Hello?". Your first spoken line:`
        : `Conversation so far:\n${history.map((t) => `${t.speaker === 'agent' ? 'YOU' : 'TARGET'}: ${t.text}`).join('\n')}\n\nYour next spoken line:`;
      const turn = await runClaudeSession(system, first);
      this.sessionId = turn.sessionId;
      raw = turn.result;
    } else {
      const lastTarget = [...history].reverse().find((t) => t.speaker === 'target');
      const user = lastTarget
        ? `The target replied: "${lastTarget.text}". Your next spoken line:`
        : `Your next spoken line:`;
      const turn = await runClaudeSession('', user, this.sessionId);
      if (turn.sessionId) this.sessionId = turn.sessionId;
      raw = turn.result;
    }

    const end = raw.includes(END_TOKEN);
    return { text: raw.replace(END_TOKEN, '').trim(), end };
  }
}
