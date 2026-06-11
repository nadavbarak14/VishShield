import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ClaudeAgent } from '../agent/claudeAgent.js';
import { MockVoiceAgent } from '../agent/mockVoiceAgent.js';
import { ClaudeTarget } from '../target/claudeTarget.js';
import { MockVoiceTarget, type MockPerson } from '../target/mockVoiceTarget.js';
import { MockCallEngine } from '../callEngine/mockCallEngine.js';
import { MockKnowledgeBase } from '../knowledge/mockKnowledgeBase.js';
import { InMemoryConversationStore } from '../store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../store/keyInfoStore.js';
import { SecretLeakExtractor } from '../extract/secretLeakExtractor.js';
import { runCampaign } from './runCampaign.js';
import { RosterKnowledgeBase } from '../knowledge/rosterKnowledgeBase.js';
import { ClaudeOperator } from '../operator/claudeOperator.js';
import { AiOperator } from '../operator/aiOperator.js';
import { buildDemoRunArgs } from './demoScenario.js';
import { runOperation } from './runOperation.js';
import { scenarioKind } from './scenarioKind.js';
import { DialClient } from '../dial/dialClient.js';
import { DialConductor } from '../dial/dialConductor.js';
import type { CallConductor } from '../conductor/callConductor.js';
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
  const targetPersona: string =
    scenario.targetPersona ??
    `${scenario.facts[scenario.targetId]?.find((f: any) => f.key === 'name')?.value ?? 'an employee'}, ${scenario.facts[scenario.targetId]?.find((f: any) => f.key === 'role')?.value ?? ''}`;

  // Calls are MOCKED by default (deterministic, no live role-players); opt back into a live
  // Claude call with "mockCalls": false in the scenario.
  const useMock = scenario.mockCalls !== false;
  const targetName: string =
    scenario.facts?.[scenario.targetId]?.find((f: any) => f.key === 'name')?.value ?? scenario.targetId;
  const agent = useMock ? new MockVoiceAgent() : new ClaudeAgent();
  const target = useMock
    ? new MockVoiceTarget({ name: targetName, secret: scenario.objective.secret })
    : new ClaudeTarget(targetPersona, scenario.objective.secret);

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
  // A demo scenario carries its own full script (operator decisions + call transcripts)
  // and runs through the same runOperation, just paced and with no LLM.
  if (scenario.demo === true) {
    return runOperation(buildDemoRunArgs(scenario, bus));
  }

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

  // Mock-call mode (the DEFAULT): the OPERATOR is the real Claude (sonnet) doing genuine
  // thinking, but each call is a deterministic fixture instead of a live role-player — which
  // sidesteps the safety refusals / out-of-character monologues the live victim/caller hit.
  // The operator still decides who to call and why; the mock just returns a transcript + leak
  // verdict. Opt back into live role-player calls with "mockCalls": false in the scenario.
  const useMock = scenario.mockCalls !== false;
  const mockMap: Record<string, MockPerson> = {};
  for (const p of scenario.roster) mockMap[p.id] = { name: p.name, secret: p.secret, hint: p.hint };

  const callBackend = process.env.VISH_CALL_BACKEND ?? 'simulated';
  let conductor: CallConductor | undefined;
  if (callBackend === 'dial') {
    const apiKey = process.env.DIAL_API_KEY;
    const fromNumberId = process.env.DIAL_FROM_NUMBER_ID;
    if (!apiKey || !fromNumberId) {
      throw new Error('VISH_CALL_BACKEND=dial requires DIAL_API_KEY and DIAL_FROM_NUMBER_ID.');
    }
    conductor = new DialConductor({
      client: new DialClient({ apiKey, baseUrl: process.env.DIAL_BASE_URL }),
      fromNumberId,
      extractor: new SecretLeakExtractor(),
      bus,
      dryRun: process.env.VISH_DIAL_DRY_RUN !== 'false',
      pollMs: process.env.DIAL_POLL_MS ? Number(process.env.DIAL_POLL_MS) : undefined,
      timeoutMs: process.env.DIAL_TIMEOUT_MS ? Number(process.env.DIAL_TIMEOUT_MS) : undefined,
      language: process.env.DIAL_LANGUAGE,
    });
  }

  const operationId = `${scenario.campaignId}-${Date.now()}`;
  return runOperation({
    operationId,
    goal: scenario.goal,
    roster: new RosterKnowledgeBase(roster),
    fixtures,
    operator: (process.env.VISH_OPERATOR_BACKEND ?? 'ai') === 'claude'
      ? new ClaudeOperator(scenario.goal, roster)
      : new AiOperator(scenario.goal, roster),
    conductor,
    makeAgent: useMock ? () => new MockVoiceAgent() : () => new ClaudeAgent(),
    makeTarget: useMock
      ? (id) => new MockVoiceTarget(mockMap[id])
      : (_id, targetPersona, secret) => new ClaudeTarget(targetPersona, secret ?? ''),
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus,
    maxHops: scenario.maxHops ?? 5,
    stopOnGoal: true,
  });
}
