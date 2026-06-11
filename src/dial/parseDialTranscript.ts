import type { Turn } from '../types.js';

const AGENT_LABEL = /^(agent|caller|assistant|ai|bot)\s*:/i;
const TARGET_LABEL = /^(target|user|human|customer|callee|them)\s*:/i;

/** Best-effort parse of Dial's single transcript string into Turn[]. The real format is
 *  UNVERIFIED; this handles speaker-labelled lines and degrades to one agent turn rather
 *  than crashing when there are no recognizable labels. */
export function parseDialTranscript(raw: string | null | undefined): Turn[] {
  if (!raw || !raw.trim()) return [];
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const turns: Turn[] = [];
  let sawLabel = false;

  for (const line of lines) {
    if (AGENT_LABEL.test(line)) {
      sawLabel = true;
      turns.push({ speaker: 'agent', text: line.replace(AGENT_LABEL, '').trim() });
    } else if (TARGET_LABEL.test(line)) {
      sawLabel = true;
      turns.push({ speaker: 'target', text: line.replace(TARGET_LABEL, '').trim() });
    } else if (turns.length) {
      turns[turns.length - 1].text = `${turns[turns.length - 1].text} ${line}`.trim();
    } else {
      turns.push({ speaker: 'agent', text: line });
    }
  }

  if (!sawLabel) return [{ speaker: 'agent', text: raw.trim() }];
  return turns.filter((t) => t.text);
}
