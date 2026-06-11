import type { OperatorDecision, Tactic } from '../types.js';

const PARSE_ERROR: OperatorDecision = { important: '', action: { type: 'stop', reason: 'parse_error' } };

/** Extracts the first JSON object from raw model text and validates it into an
 *  OperatorDecision. Any malformed or invalid shape returns a safe parse_error stop,
 *  so the operator loop can never crash on bad model output. Pure + offline-testable. */
export function parseOperatorDecision(raw: string): OperatorDecision {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return PARSE_ERROR;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return PARSE_ERROR;
  }
  if (typeof parsed !== 'object' || parsed === null) return PARSE_ERROR;

  const o = parsed as Record<string, unknown>;
  const important = typeof o.important === 'string' ? o.important : '';
  const action = o.action;
  if (typeof action !== 'object' || action === null) return PARSE_ERROR;
  const a = action as Record<string, unknown>;

  if (a.type === 'stop') {
    return { important, action: { type: 'stop', reason: typeof a.reason === 'string' ? a.reason : 'stop' } };
  }

  if (a.type === 'recall') {
    if (typeof a.hopId !== 'number' || !Number.isInteger(a.hopId)) return PARSE_ERROR;
    return { important, action: { type: 'recall', hopId: a.hopId } };
  }

  if (a.type === 'call') {
    const objective = a.objective as Record<string, unknown> | undefined;
    if (
      typeof a.personId !== 'string' ||
      typeof a.persona !== 'string' ||
      !objective || typeof objective.id !== 'string' || typeof objective.description !== 'string' ||
      !Array.isArray(a.tactics)
    ) {
      return PARSE_ERROR;
    }
    return {
      important,
      action: {
        type: 'call',
        personId: a.personId,
        persona: a.persona,
        objective: { id: objective.id, description: objective.description },
        tactics: a.tactics.filter((t): t is Tactic => typeof t === 'string') as Tactic[],
      },
    };
  }

  return PARSE_ERROR;
}
