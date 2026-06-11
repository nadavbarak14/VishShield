import type { Agent } from './agent.js';
import type { AgentSession, Transcript } from '../types.js';

export class ScriptedAgent implements Agent {
  private i = 0;
  constructor(private readonly lines: string[]) {}
  async nextUtterance(_session: AgentSession, _history: Transcript): Promise<{ text: string; end: boolean }> {
    if (this.i >= this.lines.length) return { text: '', end: true };
    const text = this.lines[this.i++];
    return { text, end: this.i >= this.lines.length };
  }
}
