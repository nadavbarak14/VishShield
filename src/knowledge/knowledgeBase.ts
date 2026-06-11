import type { Fact } from '../types.js';

export interface KnowledgeBase {
  getContext(targetId: string): Promise<Fact[]>;
}
