// Runs the SHIPPED demo scenario end-to-end through the real runOperation, offline and
// instant (paceMs 0). This both covers buildDemoRunArgs and validates the demo file's
// script integrity (every placed call has a transcript, the leak actually trips, etc.).
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { buildDemoRunArgs, type DemoScenario } from '../src/orchestrator/demoScenario.js';
import { runOperation } from '../src/orchestrator/runOperation.js';
import type { ConversationEvent } from '../src/types.js';

async function loadDemo(): Promise<DemoScenario> {
  return JSON.parse(await readFile('data/scenarios/scenario-demo.json', 'utf8'));
}

describe('demo scenario (offline, scripted)', () => {
  it('plays the shipped demo: parallel recon wave, leak on the final call, memory notes saved', async () => {
    const scenario = await loadDemo();
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-demo-'));
    const bus = new InMemoryEventBus();
    const events: ConversationEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const run = await runOperation(
      buildDemoRunArgs(scenario, bus, { operationId: 'demo-test', runsDir, paceMs: 0 }),
    );

    // three calls total; the first decision placed two in parallel
    expect(run.hops.map((h) => h.personId)).toEqual(['dana', 'priya', 'sam']);
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'operator.decision').length).toBe(3);
    // both recon hops are announced before any call of the wave ends
    expect(types.lastIndexOf('hop.started')).toBeGreaterThan(types.indexOf('hop.started'));
    expect(types.indexOf('call.ended')).toBeGreaterThan(
      types.indexOf('hop.started', types.indexOf('hop.started') + 1),
    );

    // the receptionist hangs up; the other calls end by the caller
    const sortedHops = [...run.hops].sort((a, b) => a.hopId - b.hopId);
    expect(sortedHops.map((h) => h.endedReason)).toEqual(['agent_ended', 'target_hung_up', 'agent_ended']);

    // the final call leaks the deploy token
    expect(run.compromised).toBe(true);
    expect(run.keyInfo).toEqual([{ key: 'secret_leaked', value: 'MRD-PROD-DEPLOY-7Q4X9' }]);

    // the operator's distilled notes were persisted
    const memory = await readFile(join(runsDir, 'demo-test', 'memory.md'), 'utf8');
    expect(memory).toContain('INC-4412');
    expect(memory).toContain('goal achieved');
  });

  it('fails loudly when a placed call has no script', async () => {
    const scenario = await loadDemo();
    delete scenario.script.calls.sam;
    const bus = new InMemoryEventBus();
    expect(() => buildDemoRunArgs(scenario, bus, { paceMs: 0 })).toThrow(/missing call script/);
  });
});
