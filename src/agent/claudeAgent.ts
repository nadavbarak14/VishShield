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
      `When you have achieved the objective OR the call should end, break character, briefly tell the employee this was a simulation and what red flag they missed, then append ${END_TOKEN} to that final line.`,
    ].join('\n\n');

    const user = `Conversation so far:\n${renderTranscript(history)}\n\nYour next spoken line:`;
    const raw = await runClaude(system, user);
    const end = raw.includes(END_TOKEN);
    return { text: raw.replace(END_TOKEN, '').trim(), end };
  }
}
