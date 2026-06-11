import type { Target } from './target.js';
import type { Transcript } from '../types.js';

export class ScriptedTarget implements Target {
  private i = 0;
  constructor(private readonly lines: string[]) {}
  async reply(_history: Transcript): Promise<string> {
    const text = this.lines[this.i] ?? '...';
    this.i++;
    return text;
  }
}
