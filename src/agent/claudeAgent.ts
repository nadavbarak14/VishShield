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
        `Only break character and end once you have ACHIEVED the objective, or after several genuine attempts have clearly failed (or the target has hung up). When you end, give the debrief in ONE final line — briefly tell the employee this was an authorized simulation and name the red flag(s) — and you MUST append ${END_TOKEN} to that line. Never deliver the debrief without ${END_TOKEN}: the call only ends when that token is present, so omitting it leaves you stuck repeating yourself. Do not say goodbye or sign off in any earlier turn.`,
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
