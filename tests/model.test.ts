import { describe, it, expect } from 'vitest';
import { resolveModelSpec } from '../src/ai/model.js';

describe('resolveModelSpec', () => {
  it('defaults to google + gemini-2.5-flash', () => {
    expect(resolveModelSpec({})).toEqual({ provider: 'google', modelId: 'gemini-2.5-flash' });
  });

  it('honors VISH_OPERATOR_PROVIDER and VISH_AI_OPERATOR_MODEL', () => {
    expect(resolveModelSpec({ VISH_OPERATOR_PROVIDER: 'anthropic', VISH_AI_OPERATOR_MODEL: 'claude-sonnet-4-6' }))
      .toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
  });

  it('falls back to a sensible default model id per provider when none is set', () => {
    expect(resolveModelSpec({ VISH_OPERATOR_PROVIDER: 'openai' }).modelId).toBe('gpt-4o-mini');
  });

  it('throws on an unknown provider, naming the accepted values', () => {
    expect(() => resolveModelSpec({ VISH_OPERATOR_PROVIDER: 'cohere' })).toThrow(/google.*anthropic.*openai/);
  });
});
