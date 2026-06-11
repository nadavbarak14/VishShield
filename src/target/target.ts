import type { Transcript } from '../types.js';

export interface Target {
  /** Given the conversation so far (ending with the agent's latest line), reply as the human. */
  reply(history: Transcript): Promise<string>;
}
