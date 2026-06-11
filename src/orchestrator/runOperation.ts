import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent } from '../agent/agent.js';
import type { Target } from '../target/target.js';
import type { CallEngine } from '../callEngine/callEngine.js';
import type { ConversationStore } from '../store/conversationStore.js';
import type { KeyInfoStore } from '../store/keyInfoStore.js';
import type { KeyInfoExtractor } from '../extract/keyInfoExtractor.js';
import type { EventBus } from '../events/eventBus.js';
import type { Operator } from '../operator/operator.js';
import type { PeopleKnowledgeBase } from '../knowledge/rosterKnowledgeBase.js';
import type { CallResult, Fact, Objective, OperationHop, OperationRun, OperatorDecision } from '../types.js';
import { MockCallEngine } from '../callEngine/mockCallEngine.js';
import { runCampaign } from './runCampaign.js';

export interface RunOperationArgs {
  operationId: string;
  goal: string;
  roster: PeopleKnowledgeBase;
  /** sim-only fixtures keyed by personId; NEVER exposed to the operator or talker. */
  fixtures: Record<string, { secret?: string; targetPersona: string }>;
  operator: Operator;
  /** `personId` lets scripted/demo factories pick the right canned lines per call. */
  makeAgent: (persona: string, personId?: string) => Agent;
  /** `persona` here is the TARGET's behavioral persona (resolved from fixtures). */
  makeTarget: (personId: string, persona: string, secret?: string) => Target;
  makeCallEngine?: (target: Target) => CallEngine;
  conversationStore: ConversationStore;
  keyInfoStore: KeyInfoStore;
  extractor: KeyInfoExtractor;
  bus: EventBus;
  maxHops?: number;
  runsDir?: string;
}

export async function runOperation(args: RunOperationArgs): Promise<OperationRun> {
  const maxHops = args.maxHops ?? 5;
  const runsDir = args.runsDir ?? 'data/runs';
  const makeCallEngine = args.makeCallEngine ?? ((t: Target) => new MockCallEngine(t));
  const opDir = join(runsDir, args.operationId);
  const memoryFile = join(opDir, 'memory.md');
  await mkdir(join(opDir, 'calls'), { recursive: true });

  const hops: OperationHop[] = [];
  let last: CallResult[] | undefined;
  let completed = 0;
  let stopped = false;
  let seq = 0;

  const MAX_RECALLS = 3;
  const historyOf = () => hops.map((h) => ({ hopId: h.hopId, personId: h.personId }));
  const emitDecision = (d: OperatorDecision) =>
    args.bus.emit({ type: 'operator.decision', operationId: args.operationId, seq: seq++, thinking: d.thinking, important: d.important, action: d.action });

  while (completed < maxHops) {
    // Ask the operator. It may first `recall` past transcripts (bounded) before committing
    // to a call/stop — a recall places no call and counts no hop. Every decision is emitted
    // so the UI can show the operator's reasoning + how it handled each call's result.
    let decision = await args.operator.decideNext({ last, history: historyOf() });
    emitDecision(decision);
    if (decision.important) await appendFile(memoryFile, `## after hop ${completed}\n${decision.important}\n`);

    let recalls = 0;
    while (decision.action.type === 'recall' && recalls < MAX_RECALLS) {
      const recall = decision.action;   // narrowed to the recall variant
      const found = hops.find((h) => h.hopId === recall.hopId);
      recalls++;
      decision = await args.operator.decideNext({
        last,
        recalled: { hopId: recall.hopId, transcript: found?.transcript ?? [] },
        history: historyOf(),
      });
      emitDecision(decision);
      if (decision.important) await appendFile(memoryFile, `## after hop ${completed}\n${decision.important}\n`);
    }

    // After any recalls, the decision is stop / call (or a recall that exceeded the budget).
    if (decision.action.type !== 'call') {
      stopped = true;
      break;
    }

    // The wave: 1..MAX_PARALLEL_CALLS calls placed at once, trimmed to the hop budget.
    const orders = decision.action.calls.slice(0, maxHops - completed);
    if (orders.length === 0) {
      stopped = true;
      break;
    }

    // Validate every person up-front, before any hop is announced.
    const people = await Promise.all(orders.map((o) => args.roster.getPerson(o.personId)));
    const missingAt = people.findIndex((p) => !p);
    if (missingAt !== -1) {
      await appendFile(memoryFile, `## note\nunknown person ${orders[missingAt].personId}; stopping\n`);
      stopped = true;
      break;
    }

    const baseHop = completed;
    // Announce the whole wave before any call runs, so the UI shows parallel dialing.
    orders.forEach((order, i) => {
      const person = people[i]!;
      args.bus.emit({
        type: 'hop.started', operationId: args.operationId, hopId: baseHop + i + 1,
        personId: order.personId, name: person.name, title: person.title,
      });
    });

    // Run the wave concurrently. Each call's events carry its own conversationId
    // (`<op>-hop-<n>`), so interleaved turns stay attributable. The async callbacks run
    // synchronously up to their first await, in array order — so make*-factory calls
    // stay deterministic for scripted/demo implementations.
    const results = await Promise.all(orders.map(async (order, i) => {
      const hopId = baseHop + i + 1;
      const objective: Objective = { ...order.objective, secret: args.fixtures[order.personId]?.secret };
      const agent = args.makeAgent(order.persona, order.personId);
      const target = args.makeTarget(order.personId, args.fixtures[order.personId]?.targetPersona ?? '', objective.secret);

      const { conversation, keyInfo } = await runCampaign({
        conversationId: `${args.operationId}-hop-${hopId}`,
        campaignId: args.operationId,
        targetId: order.personId,
        objective,
        allowedTactics: order.tactics,
        persona: order.persona,
        agent,
        callEngine: makeCallEngine(target),
        kb: args.roster,
        conversationStore: args.conversationStore,
        keyInfoStore: args.keyInfoStore,
        extractor: args.extractor,
        bus: args.bus,
      });

      const leaked = keyInfo.length > 0;
      const hop: OperationHop = {
        hopId,
        personId: order.personId,
        persona: order.persona,
        objective,
        transcript: conversation.transcript,
        endedReason: conversation.endedReason,
        leaked,
      };
      await writeFile(join(opDir, 'calls', `hop-${hopId}-${order.personId}.json`), JSON.stringify(hop, null, 2));
      args.bus.emit({ type: 'hop.ended', operationId: args.operationId, hopId, personId: order.personId, leaked });
      return hop;
    }));

    hops.push(...results);   // Promise.all preserves array order → hops stay in hopId order
    last = results.map((h) => ({ hopId: h.hopId, personId: h.personId, transcript: h.transcript, leaked: h.leaked }));
    completed += results.length;
  }

  if (!stopped) {
    await appendFile(memoryFile, `## note\nmax_hops (${maxHops}) reached\n`);
  }

  const keyInfo: Fact[] = hops
    .filter((h) => h.leaked)
    .map((h) => ({ key: 'secret_leaked', value: h.objective.secret ?? '' }));

  const run: OperationRun = {
    id: args.operationId,
    goal: args.goal,
    hops,
    keyInfo,
    compromised: hops.some((h) => h.leaked),
  };
  await writeFile(join(opDir, 'operation.json'), JSON.stringify(run, null, 2));
  return run;
}
