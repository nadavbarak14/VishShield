import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export type Provider = 'google' | 'anthropic' | 'openai';

const DEFAULT_MODEL: Record<Provider, string> = {
  google: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
};

export interface ModelSpec { provider: Provider; modelId: string; }

/** Pure env -> spec resolution. Default provider google, default model per-provider.
 *  `VISH_AI_OPERATOR_MODEL` is deliberately distinct from `VISH_OPERATOR_MODEL`
 *  (the latter is the Claude-subprocess model in runClaude.ts). */
export function resolveModelSpec(env: Record<string, string | undefined>): ModelSpec {
  const provider = (env.VISH_OPERATOR_PROVIDER ?? 'google') as string;
  if (provider !== 'google' && provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`Unknown VISH_OPERATOR_PROVIDER "${provider}". Accepted: google, anthropic, openai.`);
  }
  const modelId = env.VISH_AI_OPERATOR_MODEL ?? DEFAULT_MODEL[provider];
  return { provider, modelId };
}

/** Builds the AI SDK LanguageModel from env. API keys come from each provider's standard
 *  env var (e.g. GOOGLE_GENERATIVE_AI_API_KEY) and are read by the provider factory itself. */
export function getOperatorModel(env: Record<string, string | undefined> = process.env): LanguageModel {
  const { provider, modelId } = resolveModelSpec(env);
  if (provider === 'anthropic') return anthropic(modelId);
  if (provider === 'openai') return openai(modelId);
  return google(modelId);
}
