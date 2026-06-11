import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSession, MAX_SESSION_CALLS } from '../src/orchestrator/runSession.js';
import { ScriptedOperator } from '../src/operator/scriptedOperator.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';

async function fixtures() {
  const dir = await mkdtemp(join(tmpdir(), 'sess-'));
  await writeFile(join(dir, 'org.json'), JSON.stringify({
    id: 'acme', name: 'Acme',
    people: [{ id: 'sam', name: 'Sam', title: 'SRE', phone: '+1', department: 'Eng', publicInfo: 'on-call', secret: 'TKN', targetPersona: 'stretched' }],
  }));
  const tdir = join(dir, 'tactics');
  await mkdir(tdir, { recursive: true });
  await writeFile(join(tdir, 'a.json'), JSON.stringify({ id: 'a', name: 'Alpha', summary: 's', instructions: 'do alpha' }));
  return { orgFile: join(dir, 'org.json'), tacticsDir: tdir, runsDir: join(dir, 'runs') };
}

describe('runSession', () => {
  it('runs an LLM-less session and records the selected tactics + cap', async () => {
    const f = await fixtures();
    let capturedGuidance = '';
    const run = await runSession(
      { tacticIds: ['a'], preferredTargetId: 'sam' },
      new InMemoryEventBus(),
      {
        orgFile: f.orgFile, tacticsDir: f.tacticsDir, runsDir: f.runsDir,
        makeOperator: (guidance, _roster) => {
          capturedGuidance = guidance;
          // stop immediately: a no-call session is enough to assert wiring
          return new ScriptedOperator([{ thinking: 't', important: '', action: { type: 'stop', reason: 'done' } }]);
        },
      },
    );
    expect(capturedGuidance).toContain('Alpha — do alpha');
    expect(capturedGuidance).toContain('Preferred entry point: Sam (SRE).');
    expect(run.tactics).toEqual([{ id: 'a', name: 'Alpha' }]);
    expect(run.preferredTargetId).toBe('sam');
    expect(MAX_SESSION_CALLS).toBe(5);
  });
});
