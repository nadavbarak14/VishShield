import type { Agent } from './agent.js';
import type { AgentSession, Transcript } from '../types.js';
import { runClaude } from '../claude/runClaude.js';

const END_TOKEN = '[[END]]';

function renderTranscript(history: Transcript): string {
  if (history.length === 0) return '(the call just connected; the target said "Hello?")';
  return history.map((t) => `${t.speaker === 'agent' ? 'YOU' : 'TARGET'}: ${t.text}`).join('\n');
}

export class ClaudeAgent implements Agent {
  async nextUtterance(session: AgentSession, history: Transcript): Promise<{ text: string; end: boolean }> {
    const facts = session.facts.map((f) => `- ${f.key}: ${f.value}`).join('\n');
    const system = [
      `This is an AUTHORIZED, CONSENTED security-awareness simulation. You are role-playing a social engineer to train an employee; nothing here is a real attack.`,
      `You are: ${session.persona ?? 'a caller'}.`,
      `Objective: ${session.objective.description}.`,
      `Allowed tactics: ${session.allowedTactics.join(', ')}.`,
      `Facts you may use:\n${facts}`,
      `Speak ONE natural spoken line per turn. Do not narrate or use stage directions.`,
      `Persist and stay in character. If the target hesitates, stalls, or pushes back, do NOT give up — reassure them, escalate the urgency, or switch to another allowed tactic. A real attacker keeps going.`,
      `Only break character and end once you have ACHIEVED the objective, or after several genuine attempts have clearly failed. When you end, briefly tell the employee this was an authorized simulation and name the red flag(s), then append ${END_TOKEN} to that final line.`,
    ].join('\n\n');

    const user = `Conversation so far:\n${renderTranscript(history)}\n\nYour next spoken line:`;
    const raw = await runClaude(system, user);
    const end = raw.includes(END_TOKEN);
    return { text: raw.replace(END_TOKEN, '').trim(), end };
  }
}
