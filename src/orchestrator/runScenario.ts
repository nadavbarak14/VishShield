import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ClaudeAgent } from '../agent/claudeAgent.js';
import { ClaudeTarget } from '../target/claudeTarget.js';
import { MockCallEngine } from '../callEngine/mockCallEngine.js';
import { MockKnowledgeBase } from '../knowledge/mockKnowledgeBase.js';
import { InMemoryConversationStore } from '../store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../store/keyInfoStore.js';
import { SecretLeakExtractor } from '../extract/secretLeakExtractor.js';
import { runCampaign } from './runCampaign.js';
import { RosterKnowledgeBase } from '../knowledge/rosterKnowledgeBase.js';
import { ClaudeOperator } from '../operator/claudeOperator.js';
import { runOperation } from './runOperation.js';
import { scenarioKind } from './scenarioKind.js';
import type { EventBus } from '../events/eventBus.js';
import type { OperationRun, Person, Transcript } from '../types.js';

export interface SavedRun {
  id: string;
  campaignId: string;
  objective: { description: string; secret?: string };
  attackerPersona: string;
  targetPersona: string;
  transcript: Transcript;
  endedReason: string;
  keyInfo: { key: string; value: string }[];
  compromised: boolean;
}

/** Runs one scenario file end-to-end with the live Claude agent + target, emitting
 *  events to `bus`, persisting the result to data/runs/, and returning the run.
 *  Shared by the `play` CLI and the dashboard. Makes live `claude -p` calls. */
export async function runScenario(scenarioFile: string, bus: EventBus): Promise<SavedRun | OperationRun> {
  const scenario = JSON.parse(await readFile(scenarioFile, 'utf8'));

  if (scenarioKind(scenario) === 'operation') {
    return runOperationScenario(scenario, bus);
  }

  const kb = new MockKnowledgeBase(scenario.facts);
  const agent = new ClaudeAgent();
  const targetPersona: string =
    scenario.targetPersona ??
    `${scenario.facts[scenario.targetId]?.find((f: any) => f.key === 'name')?.value ?? 'an employee'}, ${scenario.facts[scenario.targetId]?.find((f: any) => f.key === 'role')?.value ?? ''}`;
  const target = new ClaudeTarget(targetPersona, scenario.objective.secret);

  const runId = `${scenario.campaignId}-${Date.now()}`;
  const result = await runCampaign({
    conversationId: runId,
    campaignId: scenario.campaignId,
    targetId: scenario.targetId,
    objective: scenario.objective,
    allowedTactics: scenario.allowedTactics,
    persona: scenario.persona,
    agent,
    callEngine: new MockCallEngine(target),
    kb,
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus,
  });

  const run: SavedRun = {
    id: runId,
    campaignId: scenario.campaignId,
    objective: scenario.objective,
    attackerPersona: scenario.persona,
    targetPersona,
    transcript: result.conversation.transcript,
    endedReason: result.conversation.endedReason,
    keyInfo: result.keyInfo,
    compromised: result.keyInfo.length > 0,
  };

  await mkdir('data/runs', { recursive: true });
  await writeFile(`data/runs/${runId}.json`, JSON.stringify(run, null, 2));
  return run;
}

async function runOperationScenario(scenario: any, bus: EventBus): Promise<OperationRun> {
  const roster: Person[] = scenario.roster.map((p: any) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    phone: p.phone,
    department: p.department,
    publicInfo: p.publicInfo,
  }));

  const fixtures: Record<string, { secret?: string; targetPersona: string }> = {};
  for (const p of scenario.roster) {
    fixtures[p.id] = { secret: p.secret, targetPersona: p.targetPersona };
  }

  const operationId = `${scenario.campaignId}-${Date.now()}`;
  return runOperation({
    operationId,
    goal: scenario.goal,
    roster: new RosterKnowledgeBase(roster),
    fixtures,
    operator: new ClaudeOperator(scenario.goal, roster),
    makeAgent: () => new ClaudeAgent(),
    makeTarget: (_id, targetPersona, secret) => new ClaudeTarget(targetPersona, secret ?? ''),
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus,
    maxHops: scenario.maxHops ?? 5,
  });
}
