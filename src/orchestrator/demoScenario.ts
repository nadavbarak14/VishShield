import type { Agent } from '../agent/agent.js';
import type { Operator, OperatorInput } from '../operator/operator.js';
import type { Target } from '../target/target.js';
import type { EventBus } from '../events/eventBus.js';
import type { AgentSession, OperatorDecision, Person, Transcript, Turn } from '../types.js';
import { TARGET_HANGUP_TOKEN } from '../target/target.js';
import { ScriptedOperator } from '../operator/scriptedOperator.js';
import { RosterKnowledgeBase } from '../knowledge/rosterKnowledgeBase.js';
import { InMemoryConversationStore } from '../store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../store/keyInfoStore.js';
import { SecretLeakExtractor } from '../extract/secretLeakExtractor.js';
import type { RunOperationArgs } from './runOperation.js';

/** A demo scenario file: a normal operation scenario plus a full script — canned operator
 *  decisions and one canned transcript per call placed. Runs through the REAL runOperation
 *  (same events, same persistence) with small delays, so the dashboard shows the whole
 *  process — parallel waves included — without any LLM. */
export interface DemoScenario {
  campaignId: string;
  demo: true;
  goal: string;
  maxHops?: number;
  /** Delay per conversational turn; operator decisions take 2×. 0 = instant (tests). */
  paceMs?: number;
  roster: (Person & { secret?: string; targetPersona?: string })[];
  script: {
    decisions: OperatorDecision[];
    /** Call scripts per personId, consumed in placement order when a person is called more than once. */
    calls: Record<string, { transcript: Turn[] }[]>;
  };
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

class PacedOperator implements Operator {
  constructor(private readonly inner: Operator, private readonly ms: number) {}
  async decideNext(input: OperatorInput): Promise<OperatorDecision> {
    await sleep(this.ms);
    return this.inner.decideNext(input);
  }
}

/** Plays the agent side of one canned transcript. Ends the call after its last line only
 *  when the script ends on an agent turn; otherwise the target's final line closes it. */
class PacedScriptedAgent implements Agent {
  private i = 0;
  constructor(private readonly lines: string[], private readonly endsCall: boolean, private readonly ms: number) {}
  async nextUtterance(_session: AgentSession, _history: Transcript): Promise<{ text: string; end: boolean }> {
    await sleep(this.ms);
    if (this.i >= this.lines.length) return { text: '', end: true };
    const text = this.lines[this.i++];
    return { text, end: this.endsCall && this.i >= this.lines.length };
  }
}

/** Plays the target side; appends the hang-up token to its last line when the script says
 *  the target ends the call. */
class PacedScriptedTarget implements Target {
  private i = 0;
  constructor(private readonly lines: string[], private readonly hangsUp: boolean, private readonly ms: number) {}
  async reply(_history: Transcript): Promise<string> {
    await sleep(this.ms);
    const isLast = this.i >= this.lines.length - 1;
    const text = this.lines[this.i] ?? '...';
    this.i++;
    return this.hangsUp && isLast ? `${text} ${TARGET_HANGUP_TOKEN}` : text;
  }
}

/** Flattens the per-person call scripts into the exact order calls will be placed
 *  (decision by decision, wave order preserved), failing loudly on a missing script. */
function scriptsInPlacementOrder(
  decisions: OperatorDecision[],
  calls: DemoScenario['script']['calls'],
): { transcript: Turn[] }[] {
  const used: Record<string, number> = {};
  const out: { transcript: Turn[] }[] = [];
  for (const d of decisions) {
    if (d.action.type !== 'call') continue;
    for (const order of d.action.calls) {
      const i = used[order.personId] ?? 0;
      used[order.personId] = i + 1;
      const script = (calls[order.personId] ?? [])[i];
      if (!script || !Array.isArray(script.transcript) || script.transcript.length === 0) {
        throw new Error(`demo scenario: missing call script for "${order.personId}" (call #${i + 1})`);
      }
      out.push(script);
    }
  }
  return out;
}

export function buildDemoRunArgs(
  scenario: DemoScenario,
  bus: EventBus,
  overrides: { operationId?: string; runsDir?: string; paceMs?: number } = {},
): RunOperationArgs {
  const paceMs = overrides.paceMs ?? scenario.paceMs ?? 700;

  const roster: Person[] = scenario.roster.map((p) => ({
    id: p.id, name: p.name, title: p.title, phone: p.phone,
    department: p.department, publicInfo: p.publicInfo,
  }));
  const fixtures: Record<string, { secret?: string; targetPersona: string }> = {};
  for (const p of scenario.roster) fixtures[p.id] = { secret: p.secret, targetPersona: p.targetPersona ?? '' };

  // makeAgent and makeTarget are each invoked exactly once per call, in placement order
  // (runOperation calls them synchronously before awaiting), so two shifted copies of the
  // same queue stay in lock-step.
  const scripts = scriptsInPlacementOrder(scenario.script.decisions, scenario.script.calls);
  const agentQueue = [...scripts];
  const targetQueue = [...scripts];

  return {
    operationId: overrides.operationId ?? `${scenario.campaignId}-${Date.now()}`,
    goal: scenario.goal,
    roster: new RosterKnowledgeBase(roster),
    fixtures,
    operator: new PacedOperator(new ScriptedOperator(scenario.script.decisions), paceMs * 2),
    makeAgent: () => {
      const script = agentQueue.shift();
      if (!script) throw new Error('demo scenario: more calls placed than scripted');
      const t = script.transcript;
      const agentEnds = t[t.length - 1].speaker === 'agent';
      return new PacedScriptedAgent(t.filter((x) => x.speaker === 'agent').map((x) => x.text), agentEnds, paceMs);
    },
    makeTarget: () => {
      const script = targetQueue.shift();
      if (!script) throw new Error('demo scenario: more calls placed than scripted');
      const t = script.transcript;
      const targetHangsUp = t[t.length - 1].speaker === 'target';
      return new PacedScriptedTarget(t.filter((x) => x.speaker === 'target').map((x) => x.text), targetHangsUp, paceMs);
    },
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus,
    maxHops: scenario.maxHops ?? 8,
    ...(overrides.runsDir ? { runsDir: overrides.runsDir } : {}),
  };
}
