import { InMemoryEventBus } from '../events/eventBus.js';
import { attachTerminalVisualizer } from '../visualizer/terminalVisualizer.js';
import { runScenario } from '../orchestrator/runScenario.js';

async function main() {
  const file = process.argv[2] ?? 'data/scenarios/scenario-a.json';

  const bus = new InMemoryEventBus();
  attachTerminalVisualizer(bus);

  const run = await runScenario(file, bus);

  console.log('\n=== KEY INFO EXTRACTED ===');
  console.log(run.keyInfo.length ? run.keyInfo : '(target did not leak the secret)');
  const savedAt = 'hops' in run ? `data/runs/${run.id}/` : `data/runs/${run.id}.json`;
  console.log(`\nSaved run → ${savedAt}   (dashboard: npm run web)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
