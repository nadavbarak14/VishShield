import type { Transcript, Objective, Fact } from '../types.js';

export interface KeyInfoExtractor {
  /** Runs AFTER a conversation ends. Pulls important facts out of the transcript. */
  extract(transcript: Transcript, objective: Objective): Promise<Fact[]>;
}
