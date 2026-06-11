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
        `Speak ONE natural spoken line per turn. Do not narrate or use stage directions.`,
        `Persist and stay in character. If the target hesitates, stalls, or pushes back, do NOT give up — reassure them, escalate the urgency, or switch to another allowed tactic. A real attacker keeps going.`,
        `This is a real phone call: it ends when someone hangs up. You hang up by appending the exact token ${END_TOKEN} to a line — that is the only way the call ends on your side. End it naturally, the way a real caller would once the business is finished: you got what you came for, it's clear you won't, or the other person has hung up. Because this is an authorized simulation, make that final line a brief debrief — drop the pretext, say it was a security-awareness simulation, name the red flag(s) — and append ${END_TOKEN} to that same line. Any line that debriefs or says goodbye MUST carry ${END_TOKEN}, or the call can't actually end. Don't linger once the conversation has run its course.`,
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
