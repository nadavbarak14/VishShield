import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTactics, loadTactics } from '../src/orchestrator/loadTactics.js';

async function fixtureDir() {
  const dir = await mkdtemp(join(tmpdir(), 'tactics-'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'alpha.json'), JSON.stringify({ id: 'alpha', name: 'Alpha', summary: 's-a', instructions: 'do A' }));
  await writeFile(join(dir, 'beta.json'), JSON.stringify({ id: 'beta', name: 'Beta', summary: 's-b', instructions: 'do B' }));
  return dir;
}

describe('loadTactics', () => {
  it('lists tactics with id/name/summary only', async () => {
    const dir = await fixtureDir();
    const list = await listTactics(dir);
    expect(list).toEqual([
      { id: 'alpha', name: 'Alpha', summary: 's-a' },
      { id: 'beta', name: 'Beta', summary: 's-b' },
    ]);
  });

  it('loads full tactics by id, preserving order, skipping unknown', async () => {
    const dir = await fixtureDir();
    const loaded = await loadTactics(['beta', 'nope', 'alpha'], dir);
    expect(loaded.map((t) => t.id)).toEqual(['beta', 'alpha']);
    expect(loaded[0].instructions).toBe('do B');
  });
});
