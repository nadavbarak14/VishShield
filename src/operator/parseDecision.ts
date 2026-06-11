import { MAX_PARALLEL_CALLS, type CallOrder, type OperatorDecision, type Tactic } from '../types.js';

/** A fresh parse_error stop each call, so a caller mutating the result can't corrupt later returns. */
const PARSE_ERROR = (): OperatorDecision => ({ important: '', action: { type: 'stop', reason: 'parse_error' } });

/** Validates one call order; null if malformed. */
function parseCallOrder(raw: unknown): CallOrder | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const objective = c.objective as Record<string, unknown> | undefined;
  if (
    typeof c.personId !== 'string' ||
    typeof c.persona !== 'string' ||
    !objective || typeof objective.id !== 'string' || typeof objective.description !== 'string' ||
    !Array.isArray(c.tactics)
  ) {
    return null;
  }
  return {
    personId: c.personId,
    persona: c.persona,
    objective: { id: objective.id, description: objective.description },
    tactics: c.tactics.filter((t): t is Tactic => typeof t === 'string') as Tactic[],
  };
}

/** Extracts the first JSON object from raw model text and validates it into an
 *  OperatorDecision. Any malformed or invalid shape returns a safe parse_error stop,
 *  so the operator loop can never crash on bad model output. Pure + offline-testable. */
export function parseOperatorDecision(raw: string): OperatorDecision {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return PARSE_ERROR();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return PARSE_ERROR();
  }
  if (typeof parsed !== 'object' || parsed === null) return PARSE_ERROR();

  const o = parsed as Record<string, unknown>;
  const important = typeof o.important === 'string' ? o.important : '';
  const action = o.action;
  if (typeof action !== 'object' || action === null) return PARSE_ERROR();
  const a = action as Record<string, unknown>;

  if (a.type === 'stop') {
    return { important, action: { type: 'stop', reason: typeof a.reason === 'string' ? a.reason : 'stop' } };
  }

  if (a.type === 'recall') {
    if (typeof a.hopId !== 'number' || !Number.isInteger(a.hopId)) return PARSE_ERROR();
    return { important, action: { type: 'recall', hopId: a.hopId } };
  }

  if (a.type === 'call') {
    // New wave shape: { type:'call', calls:[...] }. Legacy flat single-call fields are
    // still accepted (the model may fall back to them) and normalize to a 1-call wave.
    const rawOrders = Array.isArray(a.calls) ? a.calls : [a];
    if (rawOrders.length === 0) return PARSE_ERROR();
    const calls: CallOrder[] = [];
    for (const rawOrder of rawOrders.slice(0, MAX_PARALLEL_CALLS)) {
      const order = parseCallOrder(rawOrder);
      if (!order) return PARSE_ERROR();
      calls.push(order);
    }
    return { important, action: { type: 'call', calls } };
  }

  return PARSE_ERROR();
}
