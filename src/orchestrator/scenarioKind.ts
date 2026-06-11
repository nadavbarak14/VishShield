/** Decides whether a scenario file drives a single call or a multi-hop operation.
 *  An operation scenario MUST have both `roster` (array) and `goal` (string); having
 *  exactly one is a hard error, never a silent fall-through to the single-call path. */
export function scenarioKind(scenario: unknown): 'single' | 'operation' {
  const s = scenario as Record<string, unknown> | null;
  const hasRoster = Array.isArray(s?.roster);
  const hasGoal = typeof s?.goal === 'string';
  if (hasRoster !== hasGoal) {
    throw new Error('Malformed scenario: an operation scenario needs BOTH "roster" and "goal".');
  }
  return hasRoster ? 'operation' : 'single';
}
