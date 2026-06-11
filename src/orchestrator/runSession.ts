import { ClaudeAgent } from '../agent/claudeAgent.js';
import { MockVoiceAgent } from '../agent/mockVoiceAgent.js';
import { ClaudeTarget } from '../target/claudeTarget.js';
import { MockVoiceTarget } from '../target/mockVoiceTarget.js';
import { InMemoryConversationStore } from '../store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../store/keyInfoStore.js';
import { SecretLeakExtractor } from '../extract/secretLeakExtractor.js';
import { RosterKnowledgeBase } from '../knowledge/rosterKnowledgeBase.js';
import { AiOperator } from '../operator/aiOperator.js';
import { DialClient } from '../dial/dialClient.js';
import { DialConductor } from '../dial/dialConductor.js';
import { runOperation } from './runOperation.js';
import { loadOrg, ORG_FILE } from './loadOrg.js';
import { loadTactics, TACTICS_DIR } from './loadTactics.js';
import { composeGuidance } from './composeGuidance.js';
import type { Operator } from '../operator/operator.js';
import type { CallConductor } from '../conductor/callConductor.js';
import type { EventBus } from '../events/eventBus.js';
import type { OperationRun, Person } from '../types.js';

/** Hardcoded call cap for now (the single knob to revisit when we lift the limit). */
export const MAX_SESSION_CALLS = 5;

export interface SessionConfig {
  tacticIds: string[];
  preferredTargetId?: string;
}

export interface RunSessionOptions {
  orgFile?: string;
  tacticsDir?: string;
  runsDir?: string;
  /** Injectable for tests; defaults to the live LLM operator. */
  makeOperator?: (guidance: string, roster: Person[]) => Operator;
}

export async function runSession(cfg: SessionConfig, bus: EventBus, opts: RunSessionOptions = {}): Promise<OperationRun> {
  const org = await loadOrg(opts.orgFile ?? ORG_FILE);
  const tactics = await loadTactics(cfg.tacticIds, opts.tacticsDir ?? TACTICS_DIR);
  if (tactics.length === 0) throw new Error('runSession: no valid tactics selected.');

  const preferredPerson = cfg.preferredTargetId
    ? org.roster.find((p) => p.id === cfg.preferredTargetId)
    : undefined;
  const guidance = composeGuidance(
    tactics,
    preferredPerson ? { name: preferredPerson.name, title: preferredPerson.title } : undefined,
  );

  // Calls are simulated/mock by DEFAULT; only VISH_CALL_BACKEND=dial selects the real conductor.
  const callBackend = process.env.VISH_CALL_BACKEND ?? 'simulated';
  const useMock = callBackend !== 'dial';

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

  const makeOperator = opts.makeOperator ?? ((g: string, roster: Person[]) => new AiOperator(g, roster));

  const operationId = `session-${Date.now()}`;
  return runOperation({
    operationId,
    goal: guidance,
    roster: new RosterKnowledgeBase(org.roster),
    fixtures: org.fixtures,
    operator: makeOperator(guidance, org.roster),
    conductor,
    makeAgent: useMock ? () => new MockVoiceAgent() : () => new ClaudeAgent(),
    makeTarget: useMock
      ? (id) => new MockVoiceTarget(org.mockMap[id])
      : (_id, targetPersona, secret) => new ClaudeTarget(targetPersona, secret ?? ''),
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus,
    maxHops: MAX_SESSION_CALLS,
    stopOnGoal: true,
    runsDir: opts.runsDir,
    tactics: tactics.map((t) => ({ id: t.id, name: t.name })),
    preferredTargetId: preferredPerson?.id,
  });
}
