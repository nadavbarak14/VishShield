import type { ConversationEvent } from '../types.js';

export interface EventBus {
  emit(event: ConversationEvent): void;
  subscribe(listener: (event: ConversationEvent) => void): void;
}

export class InMemoryEventBus implements EventBus {
  private listeners: ((event: ConversationEvent) => void)[] = [];
  emit(event: ConversationEvent): void {
    for (const l of this.listeners) l(event);
  }
  subscribe(listener: (event: ConversationEvent) => void): void {
    this.listeners.push(listener);
  }
}
