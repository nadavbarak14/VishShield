/** Dial status handling.
 *
 *  A live Dial call reports `status` as an OBJECT, e.g.
 *    { state: "Terminated", terminationType: "completed", label: "Completed" }
 *  where `state` is the lifecycle phase (Ringing / InProgress / Terminated …) and
 *  `terminationType` is the outcome once terminated (completed / busy / no-answer /
 *  failed / canceled). Some responses / older shapes use a plain status string, so
 *  both forms are accepted. Unknown shapes are treated as non-terminal so a new
 *  status can never be misread as "the call is done"; the conductor's timeout is the
 *  backstop. */
export interface DialStatusObject {
  state?: string;
  terminationType?: string;
  label?: string;
  [k: string]: unknown;
}
export type DialStatus = string | DialStatusObject;

const TERMINAL_STRINGS = new Set(['completed', 'ended', 'failed', 'no-answer', 'busy', 'canceled', 'cancelled']);

export function isTerminal(status: DialStatus | null | undefined): boolean {
  if (status && typeof status === 'object') {
    if (typeof status.state === 'string') return status.state.toLowerCase() === 'terminated';
    if (typeof status.terminationType === 'string') return true;
    return false;
  }
  return typeof status === 'string' && TERMINAL_STRINGS.has(status);
}

export function endedReasonFor(status: DialStatus | null | undefined): string {
  if (status && typeof status === 'object') {
    const t = (status.terminationType ?? status.state ?? '').toLowerCase();
    if (t === '' || t === 'completed' || t === 'ended' || t === 'terminated') return 'completed';
    return t;
  }
  if (status === 'completed' || status === 'ended') return 'completed';
  return typeof status === 'string' ? status : 'completed';
}
