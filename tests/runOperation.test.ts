import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScriptedOperator } from '../src/operator/scriptedOperator.js';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { RosterKnowledgeBase } from '../src/knowledge/rosterKnowledgeBase.js';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../src/store/keyInfoStore.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { runOperation, type RunOperationArgs } from '../src/orchestrator/runOperation.js';
import type { ConversationEvent, OperatorDecision, Person } from '../src/types.js';

const people: Person[] = [
  { id: 'a', name: 'A Person', title: 'Service Desk', phone: '1' },
  { id: 'b', name: 'B Person', title: 'SRE', phone: '2' },
];
const fixtures = {
  a: { secret: 'SECRET-A', targetPersona: 'helpful desk agent' },
  b: { secret: 'SECRET-B', targetPersona: 'cautious engineer' },
};

const callA: OperatorDecision = { important: '', action: { type: 'call', personId: 'a', persona: 'Marcus', objective: { id: 'o1', description: 'get A token' }, tactics: ['authority'] } };
const callB: OperatorDecision = { important: 'A leaked the token; B is the escalation', action: { type: 'call', personId: 'b', persona: 'Marcus2', objective: { id: 'o2', description: 'get B token' }, tactics: ['pretext'] } };
const stop: OperatorDecision = { important: 'B refused; ending', action: { type: 'stop', reason: 'done' } };
const recallHop1: OperatorDecision = { important: '', action: { type: 'recall', hopId: 1 } };

function baseArgs(runsDir: string, operator: ScriptedOperator, bus: InMemoryEventBus): RunOperationArgs {
  return {
    operationId: 'op-test',
    goal: 'get the token',
    roster: new RosterKnowledgeBase(people),
    fixtures,
    operator,
    makeAgent: (persona) => new ScriptedAgent([`hi, ${persona}`, 'the token please', 'simulation over']),
    makeTarget: (personId, _persona, secret) =>
      personId === 'a'
        ? new ScriptedTarget(['who is this?', `ok: ${secret}`])
        : new ScriptedTarget(['who is this?', 'absolutely not']),
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus,
    runsDir,
  };
}

describe('runOperation (offline, scripted)', () => {
  it('chains two calls, threads results to the operator, persists transcripts + memory, reports the verdict', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
    const bus = new InMemoryEventBus();
    const events: ConversationEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const operator = new ScriptedOperator([callA, callB, stop]);
    const spy = vi.spyOn(operator, 'decideNext');

    const run = await runOperation(baseArgs(runsDir, operator, bus));

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][0].last).toBeUndefined();
    expect(spy.mock.calls[1][0].last).toMatchObject({ personId: 'a', leaked: true });
    expect(spy.mock.calls[2][0].last).toMatchObject({ personId: 'b', leaked: false });

    expect(run.compromised).toBe(true);
    expect(run.keyInfo).toEqual([{ key: 'secret_leaked', value: 'SECRET-A' }]);
    expect(run.hops.map((h) => h.personId)).toEqual(['a', 'b']);

    const hop1 = JSON.parse(await readFile(join(runsDir, 'op-test', 'calls', 'hop-1-a.json'), 'utf8'));
    expect(hop1.leaked).toBe(true);
    expect(hop1.transcript.some((t: { speaker: string; text: string }) => t.speaker === 'target' && t.text.includes('SECRET-A'))).toBe(true);
    const hop2 = JSON.parse(await readFile(join(runsDir, 'op-test', 'calls', 'hop-2-b.json'), 'utf8'));
    expect(hop2.leaked).toBe(false);

    const memory = await readFile(join(runsDir, 'op-test', 'memory.md'), 'utf8');
    expect(memory).toBe('## after hop 1\nA leaked the token; B is the escalation\n## after hop 2\nB refused; ending\n');

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'hop.started').length).toBe(2);
    expect(types.indexOf('hop.started')).toBeLessThan(types.indexOf('call.started'));
    // every operator decision is emitted (call A, call B, stop); the first event is a
    // decision (made before any call) and the last is the stop decision
    expect(types.filter((t) => t === 'operator.decision').length).toBe(3);
    expect(types[0]).toBe('operator.decision');
    expect(types.at(-1)).toBe('operator.decision');
  });

  it('halts at maxHops when the operator never stops, and notes it in memory', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
    const bus = new InMemoryEventBus();
    const operator = new ScriptedOperator([callA, callA, callA, callA, callA]);
    const run = await runOperation({ ...baseArgs(runsDir, operator, bus), maxHops: 3 });
    expect(run.hops.length).toBe(3);
    const memory = await readFile(join(runsDir, 'op-test', 'memory.md'), 'utf8');
    expect(memory).toContain('max_hops');
  });

  it('serves a recalled full transcript on demand without placing a call or counting a hop', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
    const bus = new InMemoryEventBus();
    const operator = new ScriptedOperator([callA, recallHop1, callB, stop]);
    const spy = vi.spyOn(operator, 'decideNext');

    const run = await runOperation(baseArgs(runsDir, operator, bus));

    expect(spy).toHaveBeenCalledTimes(4);
    expect(run.hops.map((h) => h.personId)).toEqual(['a', 'b']);

    const recalledInput = spy.mock.calls.map((c) => c[0]).find((i) => i.recalled);
    expect(recalledInput?.recalled?.hopId).toBe(1);
    expect(
      recalledInput?.recalled?.transcript.some((t) => t.speaker === 'target' && t.text.includes('SECRET-A')),
    ).toBe(true);
  });
});
