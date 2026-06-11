import { readFile } from 'node:fs/promises';
import type { Person } from '../types.js';
import type { MockPerson } from '../target/mockVoiceTarget.js';

export const ORG_FILE = 'data/org.json';

interface RawPerson {
  id: string; name: string; title: string; phone: string;
  department?: string; publicInfo?: string;
  secret?: string | null; targetPersona?: string; hint?: string;
}

export interface LoadedOrg {
  id: string;
  name: string;
  roster: Person[];                                                 // secret-free; what the operator sees
  fixtures: Record<string, { secret?: string; targetPersona: string }>;
  mockMap: Record<string, MockPerson>;
  public: { id: string; name: string; roster: Person[] };           // safe to send to the browser
}

export async function loadOrg(file = ORG_FILE): Promise<LoadedOrg> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as { id: string; name?: string; people: RawPerson[] };
  const roster: Person[] = raw.people.map((p) => ({
    id: p.id, name: p.name, title: p.title, phone: p.phone,
    department: p.department, publicInfo: p.publicInfo,
  }));
  const fixtures: LoadedOrg['fixtures'] = {};
  const mockMap: LoadedOrg['mockMap'] = {};
  for (const p of raw.people) {
    fixtures[p.id] = { secret: p.secret ?? undefined, targetPersona: p.targetPersona ?? '' };
    mockMap[p.id] = { name: p.name, secret: p.secret ?? undefined, hint: p.hint };
  }
  const id = raw.id;
  const name = raw.name ?? raw.id;
  return { id, name, roster, fixtures, mockMap, public: { id, name, roster } };
}
