import { readFile } from 'node:fs/promises';
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
  const target = new ClaudeTarget(
    `${scenario.facts[scenario.targetId]?.find((f: any) => f.key === 'name')?.value ?? 'an employee'}, ${scenario.facts[scenario.targetId]?.find((f: any) => f.key === 'role')?.value ?? ''}`,
    scenario.objective.secret,
  );

  const result = await runCampaign({
    conversationId: `${scenario.campaignId}-${Date.now()}`,
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
}

main().catch((e) => { console.error(e); process.exit(1); });
