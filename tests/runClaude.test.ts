import { describe, it, expect } from 'vitest';
import { claudeArgs, CLAUDE_MODEL } from '../src/claude/runClaude.js';

describe('claudeArgs', () => {
  it('defaults the agent/victim Claudes to the haiku model', () => {
    expect(CLAUDE_MODEL).toBe('haiku');
  });

  it('owns (replaces) the system prompt and excludes dynamic sections on a first turn', () => {
    const args = claudeArgs({ systemPrompt: 'you are a caller' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    // full replace (not append), so the default coding-agent persona is gone
    expect(args).toContain('--system-prompt');
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('you are a caller');
    expect(args).not.toContain('--append-system-prompt');
    // drop cwd/git-status/env so this repo never leaks into the persona
    expect(args).toContain('--exclude-dynamic-system-prompt-sections');
    expect(args).not.toContain('--resume');
  });

  it('pins --model haiku on a resumed turn too, without re-sending a system prompt', () => {
    const args = claudeArgs({ systemPrompt: 'ignored', resume: 'sess-123' });
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-123');
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('--append-system-prompt');
  });

  it('honors an explicit model override', () => {
    const args = claudeArgs({ systemPrompt: 'x', model: 'sonnet' });
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
  });
});
