export interface CallEngine {
  /** Deliver the agent's line to the other end and return the reply. */
  say(text: string): Promise<string>;
}
