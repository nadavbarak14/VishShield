import { describe, it, expect } from 'vitest';
import { claudeArgs, CLAUDE_MODEL } from '../src/claude/runClaude.js';

describe('claudeArgs', () => {
  it('defaults the agent/victim Claudes to the haiku model', () => {
    expect(CLAUDE_MODEL).toBe('haiku');
  });

  it('pins --model haiku on a first (system-prompt) turn', () => {
    const args = claudeArgs({ systemPrompt: 'you are a caller' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    expect(args).toContain('--append-system-prompt');
    expect(args).not.toContain('--resume');
  });

  it('pins --model haiku on a resumed turn too', () => {
    const args = claudeArgs({ systemPrompt: 'ignored', resume: 'sess-123' });
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-123');
    expect(args).not.toContain('--append-system-prompt');
  });

  it('honors an explicit model override', () => {
    const args = claudeArgs({ systemPrompt: 'x', model: 'sonnet' });
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
  });
});
