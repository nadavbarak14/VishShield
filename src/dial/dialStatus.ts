/** Dial status handling. Status strings are UNVERIFIED — confirm against a real response and
 *  adjust this set. Unknown statuses are treated as non-terminal so a new status can never be
 *  misread as "the call is done"; the conductor's timeout is the backstop. */
const TERMINAL = new Set(['completed', 'ended', 'failed', 'no-answer', 'busy', 'canceled', 'cancelled']);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

export function endedReasonFor(status: string): string {
  return status === 'completed' || status === 'ended' ? 'completed' : status;
}
