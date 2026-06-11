import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ClaudeAgent } from '../agent/claudeAgent.js';
import { ClaudeTarget } from '../target/claudeTarget.js';
import { MockCallEngine } from '../callEngine/mockCallEngine.js';
import { MockKnowledgeBase } from '../knowledge/mockKnowledgeBase.js';
import { InMemoryConversationStore } from '../store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../store/keyInfoStore.js';
import { SecretLeakExtractor } from '../extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../events/eventBus.js';
import { attachTerminalVisualizer } from '../visualizer/terminalVisualizer.js';
import { runCampaign } from '../orchestrator/runCampaign.js';

async function main() {
  const file = process.argv[2] ?? 'data/scenarios/scenario-a.json';
  const scenario = JSON.parse(await readFile(file, 'utf8'));

  const bus = new InMemoryEventBus();
  attachTerminalVisualizer(bus);

  const kb = new MockKnowledgeBase(scenario.facts);
  const agent = new ClaudeAgent();
  const targetPersona =
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

  console.log('\n=== KEY INFO EXTRACTED ===');
  console.log(result.keyInfo.length ? result.keyInfo : '(target did not leak the secret)');

  // Persist the run so the web visualizer can render it. data/runs/ is gitignored.
  await mkdir('data/runs', { recursive: true });
  const run = {
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
  await writeFile(`data/runs/${runId}.json`, JSON.stringify(run, null, 2));
  console.log(`\nSaved run → data/runs/${runId}.json   (view with: npm run web)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
