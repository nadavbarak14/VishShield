import type { Conversation } from '../types.js';

export interface ConversationStore {
  save(c: Conversation): Promise<void>;
  get(id: string): Promise<Conversation | undefined>;
}

export class InMemoryConversationStore implements ConversationStore {
  private map = new Map<string, Conversation>();
  async save(c: Conversation): Promise<void> { this.map.set(c.id, c); }
  async get(id: string): Promise<Conversation | undefined> { return this.map.get(id); }
}
