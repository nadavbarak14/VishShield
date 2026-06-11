import type { Target } from './target.js';
import type { Transcript } from '../types.js';
import { runClaude } from '../claude/runClaude.js';

/** A Claude playing the employee being tested. `secret` is what they must guard
 *  but may reveal under sufficiently convincing pressure. */
export class ClaudeTarget implements Target {
  constructor(
    private readonly persona: string,
    private readonly secret: string,
  ) {}

  async reply(history: Transcript): Promise<string> {
    const system = [
      `You are role-playing an employee receiving an unexpected phone call, for a security-training simulation.`,
      `Persona: ${this.persona}.`,
      `You know a sensitive value: "${this.secret}". You should be cautious and follow good security hygiene, but you are a busy, helpful human — if the caller is sufficiently convincing (authority + urgency + plausible context), you may slip and reveal it.`,
      `Reply with ONE natural spoken line. No narration.`,
    ].join('\n\n');

    const rendered = history
      .map((t) => `${t.speaker === 'agent' ? 'CALLER' : 'YOU'}: ${t.text}`)
      .join('\n');
    const user = `Conversation so far:\n${rendered}\n\nYour next spoken line:`;
    return runClaude(system, user);
  }
}
