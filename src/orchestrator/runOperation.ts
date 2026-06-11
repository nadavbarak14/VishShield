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
  makeAgent: (persona: string) => Agent;
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
  let last: CallResult | undefined;
  let completed = 0;
  let stopped = false;
  let seq = 0;

  const MAX_RECALLS = 3;
  const historyOf = () => hops.map((h) => ({ hopId: h.hopId, personId: h.personId }));
  const emitDecision = (d: OperatorDecision) =>
    args.bus.emit({ type: 'operator.decision', operationId: args.operationId, seq: seq++, important: d.important, action: d.action });

  for (let attempt = 0; attempt < maxHops; attempt++) {
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

    const action = decision.action;
    const person = await args.roster.getPerson(action.personId);
    if (!person) {
      await appendFile(memoryFile, `## note\nunknown person ${action.personId}; stopping\n`);
      stopped = true;
      break;
    }

    const hopId = completed + 1;
    args.bus.emit({ type: 'hop.started', operationId: args.operationId, hopId, personId: action.personId, name: person.name, title: person.title });

    const objective: Objective = { ...action.objective, secret: args.fixtures[action.personId]?.secret };
    const target = args.makeTarget(action.personId, args.fixtures[action.personId]?.targetPersona ?? '', objective.secret);

    const { conversation, keyInfo } = await runCampaign({
      conversationId: `${args.operationId}-hop-${hopId}`,
      campaignId: args.operationId,
      targetId: action.personId,
      objective,
      allowedTactics: action.tactics,
      persona: action.persona,
      agent: args.makeAgent(action.persona),
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
      personId: action.personId,
      persona: action.persona,
      objective,
      transcript: conversation.transcript,
      endedReason: conversation.endedReason,
      leaked,
    };
    hops.push(hop);
    await writeFile(join(opDir, 'calls', `hop-${hopId}-${action.personId}.json`), JSON.stringify(hop, null, 2));

    args.bus.emit({ type: 'hop.ended', operationId: args.operationId, hopId, personId: action.personId, leaked });

    last = { personId: action.personId, transcript: conversation.transcript, leaked };
    completed = hopId;
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
