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

const orderA = { personId: 'a', persona: 'Marcus', objective: { id: 'o1', description: 'get A token' }, techniques: ['authority' as const] };
const orderB = { personId: 'b', persona: 'Marcus2', objective: { id: 'o2', description: 'get B token' }, techniques: ['pretext' as const] };
const callA: OperatorDecision = { thinking: 'start with A', important: '', action: { type: 'call', calls: [orderA] } };
const callB: OperatorDecision = { thinking: 'escalate to B', important: 'A leaked the token; B is the escalation', action: { type: 'call', calls: [orderB] } };
const callBoth: OperatorDecision = { thinking: 'recon both at once', important: '', action: { type: 'call', calls: [orderA, orderB] } };
const stop: OperatorDecision = { thinking: 'nothing more to do', important: 'B refused; ending', action: { type: 'stop', reason: 'done' } };
const recallHop1: OperatorDecision = { thinking: 're-read hop 1', important: '', action: { type: 'recall', hopId: 1 } };

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
    expect(spy.mock.calls[1][0].last).toMatchObject([{ hopId: 1, personId: 'a', leaked: true }]);
    expect(spy.mock.calls[2][0].last).toMatchObject([{ hopId: 2, personId: 'b', leaked: false }]);

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

  it('runs a wave of parallel calls: announces all hops first, hands the operator every result ordered by hopId', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
    const bus = new InMemoryEventBus();
    const events: ConversationEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const operator = new ScriptedOperator([callBoth, stop]);
    const spy = vi.spyOn(operator, 'decideNext');

    const run = await runOperation(baseArgs(runsDir, operator, bus));

    // both hops announced before either call ends
    const types = events.map((e) => e.type);
    const started = [types.indexOf('hop.started'), types.lastIndexOf('hop.started')];
    expect(types.filter((t) => t === 'hop.started').length).toBe(2);
    expect(started[1]).toBeLessThan(types.indexOf('call.ended'));

    // turn events stay attributable to their own call
    const convIds = new Set(events.flatMap((e) => ('conversationId' in e ? [e.conversationId] : [])));
    expect(convIds).toEqual(new Set(['op-test-hop-1', 'op-test-hop-2']));

    // the next decision sees BOTH results, ordered by hopId
    expect(spy.mock.calls[1][0].last).toMatchObject([
      { hopId: 1, personId: 'a', leaked: true },
      { hopId: 2, personId: 'b', leaked: false },
    ]);

    expect(run.hops.map((h) => h.hopId)).toEqual([1, 2]);
    const hop1 = JSON.parse(await readFile(join(runsDir, 'op-test', 'calls', 'hop-1-a.json'), 'utf8'));
    const hop2 = JSON.parse(await readFile(join(runsDir, 'op-test', 'calls', 'hop-2-b.json'), 'utf8'));
    expect(hop1.leaked).toBe(true);
    expect(hop2.leaked).toBe(false);
  });

  it('with stopOnGoal, ends after the goal is met even if the operator wants to keep calling', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
    const bus = new InMemoryEventBus();
    // call A leaks (its scripted target reads SECRET-A); operator then tries B, then B again…
    const operator = new ScriptedOperator([callA, callB, callB, callB]);
    const spy = vi.spyOn(operator, 'decideNext');

    const run = await runOperation({ ...baseArgs(runsDir, operator, bus), stopOnGoal: true });

    // only A was actually placed; B never dialed despite the operator asking for it
    expect(run.hops.map((h) => h.personId)).toEqual(['a']);
    expect(run.compromised).toBe(true);
    // the operator still got ONE reflection turn after the win (so its reasoning is shown)
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0].last).toMatchObject([{ personId: 'a', leaked: true }]);
  });

  it('trims a wave that would exceed maxHops', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
    const bus = new InMemoryEventBus();
    const operator = new ScriptedOperator([callBoth, stop]);
    const run = await runOperation({ ...baseArgs(runsDir, operator, bus), maxHops: 1 });
    expect(run.hops.map((h) => h.personId)).toEqual(['a']);
  });

  it('passes session tactics + preferredTargetId through to the run', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
    const bus = new InMemoryEventBus();
    const operator = new ScriptedOperator([stop]);
    const run = await runOperation({
      ...baseArgs(runsDir, operator, bus),
      tactics: [{ id: 't1', name: 'T One' }],
      preferredTargetId: 'a',
    });
    expect(run.tactics).toEqual([{ id: 't1', name: 'T One' }]);
    expect(run.preferredTargetId).toBe('a');
  });
});
