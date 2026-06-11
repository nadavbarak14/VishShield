import type { CallEngine } from './callEngine.js';
import type { Target } from '../target/target.js';
import type { Turn } from '../types.js';

export class MockCallEngine implements CallEngine {
  private history: Turn[] = [];
  constructor(private readonly target: Target) {}
  async say(text: string): Promise<string> {
    this.history.push({ speaker: 'agent', text });
    const reply = await this.target.reply(this.history);
    this.history.push({ speaker: 'target', text: reply });
    return reply;
  }
}
