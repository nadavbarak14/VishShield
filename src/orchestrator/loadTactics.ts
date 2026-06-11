import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tactic } from '../types.js';

export const TACTICS_DIR = 'data/tactics';

async function readTactic(dir: string, id: string): Promise<Tactic | undefined> {
  if (!/^[\w.-]+$/.test(id)) return undefined;
  try {
    const raw = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8')) as Partial<Tactic>;
    if (!raw.id || !raw.name || typeof raw.instructions !== 'string') return undefined;
    return { id: raw.id, name: raw.name, summary: raw.summary ?? '', instructions: raw.instructions };
  } catch {
    return undefined;
  }
}

/** Public list (no instructions) for the session picker, sorted by id. */
export async function listTactics(dir = TACTICS_DIR): Promise<{ id: string; name: string; summary: string }[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const out: { id: string; name: string; summary: string }[] = [];
  for (const f of files) {
    const t = await readTactic(dir, f.replace(/\.json$/, ''));
    if (t) out.push({ id: t.id, name: t.name, summary: t.summary });
  }
  return out;
}

/** Full tactics for the given ids, in the order requested; unknown ids dropped. */
export async function loadTactics(ids: string[], dir = TACTICS_DIR): Promise<Tactic[]> {
  const out: Tactic[] = [];
  for (const id of ids) {
    const t = await readTactic(dir, id);
    if (t) out.push(t);
  }
  return out;
}
