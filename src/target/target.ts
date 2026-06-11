import type { Transcript } from '../types.js';

/** A target that wants to end the call (e.g. grew suspicious and is hanging up) appends this
 *  sentinel to its spoken line. `runConversation` detects it, strips it from the transcript,
 *  and ends the call with reason `target_hung_up`. Mirrors the caller's `[[END]]`. */
export const TARGET_HANGUP_TOKEN = '[[HANGUP]]';

export interface Target {
  /** Given the conversation so far (ending with the agent's latest line), reply as the human.
   *  May append `TARGET_HANGUP_TOKEN` to the line to hang up after speaking it. */
  reply(history: Transcript): Promise<string>;
}
