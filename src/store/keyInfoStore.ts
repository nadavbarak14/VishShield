import type { Fact } from '../types.js';

export interface KeyInfoStore {
  put(campaignId: string, facts: Fact[]): Promise<void>;
  get(campaignId: string): Promise<Fact[]>;
}

export class InMemoryKeyInfoStore implements KeyInfoStore {
  private map = new Map<string, Fact[]>();
  async put(campaignId: string, facts: Fact[]): Promise<void> {
    const existing = this.map.get(campaignId) ?? [];
    this.map.set(campaignId, [...existing, ...facts]);
  }
  async get(campaignId: string): Promise<Fact[]> { return this.map.get(campaignId) ?? []; }
}
