import type { KnowledgeBase } from './knowledgeBase.js';
import type { Fact } from '../types.js';

export class MockKnowledgeBase implements KnowledgeBase {
  constructor(private readonly data: Record<string, Fact[]>) {}
  async getContext(targetId: string): Promise<Fact[]> {
    return this.data[targetId] ?? [];
  }
}
