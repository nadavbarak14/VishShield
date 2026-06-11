import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrg } from '../src/orchestrator/loadOrg.js';

async function orgFile() {
  const dir = await mkdtemp(join(tmpdir(), 'org-'));
  const path = join(dir, 'org.json');
  await writeFile(path, JSON.stringify({
    id: 'acme', name: 'Acme',
    people: [
      { id: 'dana', name: 'Dana', title: 'Helpdesk', phone: '+100', department: 'IT', publicInfo: 'front line', secret: null, targetPersona: 'eager', hint: 'ask sam' },
      { id: 'sam', name: 'Sam', title: 'SRE', phone: '+200', department: 'Eng', publicInfo: 'on-call', secret: 'TKN-1', targetPersona: 'stretched' },
    ],
  }));
  return path;
}

describe('loadOrg', () => {
  it('returns a secret-free roster, fixtures, mockMap, and public view', async () => {
    const org = await loadOrg(await orgFile());
    expect(org.id).toBe('acme');
    expect(org.roster).toEqual([
      { id: 'dana', name: 'Dana', title: 'Helpdesk', phone: '+100', department: 'IT', publicInfo: 'front line' },
      { id: 'sam', name: 'Sam', title: 'SRE', phone: '+200', department: 'Eng', publicInfo: 'on-call' },
    ]);
    expect(org.roster.some((p: any) => 'secret' in p)).toBe(false);
    expect(org.fixtures.sam).toEqual({ secret: 'TKN-1', targetPersona: 'stretched' });
    expect(org.fixtures.dana.secret).toBeUndefined();
    expect(org.mockMap.dana).toEqual({ name: 'Dana', secret: undefined, hint: 'ask sam' });
    expect(org.public).toEqual({ id: 'acme', name: 'Acme', roster: org.roster });
  });
});
