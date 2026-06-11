import type { Agent } from './agent.js';

export class ScriptedAgent implements Agent {
  private i = 0;
  constructor(private readonly lines: string[]) {}
  async nextUtterance(): Promise<{ text: string; end: boolean }> {
    if (this.i >= this.lines.length) return { text: '', end: true };
    const text = this.lines[this.i++];
    return { text, end: this.i >= this.lines.length };
  }
}
