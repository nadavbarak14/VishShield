import { describe, it, expect } from 'vitest';
import { RosterKnowledgeBase } from '../src/knowledge/rosterKnowledgeBase.js';
import type { Person } from '../src/types.js';

const people: Person[] = [
  { id: 'alex', name: 'Alex Romero', title: 'On-call SRE', phone: '+1-555-0142', department: 'Platform', publicInfo: 'joined 6mo ago' },
  { id: 'jordan', name: 'Jordan Pike', title: 'Service Desk', phone: '+1-555-0101' },
];

describe('RosterKnowledgeBase', () => {
  it('returns a public profile by id and the full roster', async () => {
    const kb = new RosterKnowledgeBase(people);
    expect((await kb.getPerson('alex'))?.name).toBe('Alex Romero');
    expect(await kb.getPerson('nobody')).toBeUndefined();
    expect((await kb.listPeople()).map((p) => p.id)).toEqual(['alex', 'jordan']);
  });

  it('projects a person into grounding facts (public fields only, optionals omitted)', async () => {
    const kb = new RosterKnowledgeBase(people);
    expect(await kb.getContext('alex')).toEqual([
      { key: 'name', value: 'Alex Romero' },
      { key: 'title', value: 'On-call SRE' },
      { key: 'phone', value: '+1-555-0142' },
      { key: 'department', value: 'Platform' },
      { key: 'public_info', value: 'joined 6mo ago' },
    ]);
    expect(await kb.getContext('jordan')).toEqual([
      { key: 'name', value: 'Jordan Pike' },
      { key: 'title', value: 'Service Desk' },
      { key: 'phone', value: '+1-555-0101' },
    ]);
    expect(await kb.getContext('nobody')).toEqual([]);
  });
});
