import type { Tactic } from '../types.js';

/** Builds the operator's guidance block from the selected tactics and an optional
 *  preferred entry point. This string is passed as the operator's `goal` argument. */
export function composeGuidance(
  tactics: Tactic[],
  preferred?: { name: string; title?: string },
): string {
  const lines = [
    `Your objective is to extract any sensitive secret from the organization by phone, using the authorized tactics below. Choose freely which tactic(s) to apply on each call, and switch between them as the situation warrants.`,
    `TACTICS (authorized approaches — mix and adapt as needed):`,
    tactics.map((t, i) => `${i + 1}. ${t.name} — ${t.instructions}`).join('\n'),
  ];
  if (preferred) {
    const who = preferred.title ? `${preferred.name} (${preferred.title})` : preferred.name;
    lines.push(`Preferred entry point: ${who}. Start there if it makes sense, but you are free to call anyone on the roster to reach the objective.`);
  }
  return lines.join('\n\n');
}
