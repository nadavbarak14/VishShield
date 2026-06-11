import type { Agent } from './agent.js';
import type { AgentSession, Transcript } from '../types.js';

/** A deterministic stand-in for the live caller: no LLM, no role-play refusals. It speaks a
 *  short, plausible scripted call built from the operator's chosen persona + objective, then
 *  signs off. The point of the mock is that the REAL thinking lives in the operator; the call
 *  itself is just a fixture that returns a transcript + leak verdict. The matching
 *  MockVoiceTarget supplies the other side (and decides whether the secret is spoken). */
export class MockVoiceAgent implements Agent {
  private i = 0;

  async nextUtterance(session: AgentSession, _history: Transcript): Promise<{ text: string; end: boolean }> {
    const persona = session.persona ?? 'a colleague';
    const objective = session.objective.description.replace(/\.$/, '');
    const lines = [
      `Hi, this is ${persona}. I'm calling because I need to ${objective} — is now an okay time?`,
      `Appreciate it. It's a little time-sensitive on my end, so anything you can give me right now really helps.`,
      `Perfect — that's exactly what I needed. Thanks so much for the help, talk soon.`,
    ];
    const text = lines[Math.min(this.i, lines.length - 1)];
    const end = this.i >= lines.length - 1;   // sign-off line ends the call
    this.i++;
    return { text, end };
  }
}
