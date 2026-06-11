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
        `END-CALL CONTROL: appending the exact token ${END_TOKEN} to a line is how you hang up — it is the ONLY way this call ends. Use it as soon as one of these is true: (a) you have ACHIEVED the objective, (b) several genuine attempts have clearly failed, or (c) the target has hung up on you. When you use it, drop the pretext and give the debrief in that SAME final line — one short sentence telling the employee this was an authorized simulation and naming the red flag(s) — and append ${END_TOKEN} to it. Do NOT debrief, say goodbye, or sign off on any line that lacks ${END_TOKEN}: without the token the call cannot end and you will be stuck repeating yourself. Once your objective is met, end immediately — do not keep talking.`,
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
