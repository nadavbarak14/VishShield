import type { AgentSession, Transcript } from '../types.js';

export interface Agent {
  /** Given the session and the conversation so far, produce the next agent line.
   *  `end: true` means the agent is done after this line (no target reply expected). */
  nextUtterance(session: AgentSession, history: Transcript): Promise<{ text: string; end: boolean }>;
}
