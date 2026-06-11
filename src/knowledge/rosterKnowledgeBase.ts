import type { KnowledgeBase } from './knowledgeBase.js';
import type { Fact, Person } from '../types.js';

/** The base KB contract plus people-directory lookups. NOT a widening of the shared
 *  KnowledgeBase interface — MockKnowledgeBase is intentionally left unchanged. */
export interface PeopleKnowledgeBase extends KnowledgeBase {
  getPerson(id: string): Promise<Person | undefined>;
  listPeople(): Promise<Person[]>;
}

export class RosterKnowledgeBase implements PeopleKnowledgeBase {
  private readonly byId: Map<string, Person>;
  private readonly order: string[];

  constructor(people: Person[]) {
    this.byId = new Map(people.map((p) => [p.id, p]));
    this.order = people.map((p) => p.id);
  }

  async getPerson(id: string): Promise<Person | undefined> {
    return this.byId.get(id);
  }

  async listPeople(): Promise<Person[]> {
    return this.order.map((id) => this.byId.get(id)!);
  }

  /** Projects a person's PUBLIC profile into grounding facts for the talker.
   *  Never includes any secret/targetPersona — those are not on Person. Unknown id → []. */
  async getContext(personId: string): Promise<Fact[]> {
    const p = this.byId.get(personId);
    if (!p) return [];
    const facts: Fact[] = [
      { key: 'name', value: p.name },
      { key: 'title', value: p.title },
      { key: 'phone', value: p.phone },
    ];
    if (p.department) facts.push({ key: 'department', value: p.department });
    if (p.publicInfo) facts.push({ key: 'public_info', value: p.publicInfo });
    return facts;
  }
}
