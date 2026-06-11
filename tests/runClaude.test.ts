import { describe, it, expect } from 'vitest';
import { claudeArgs, CLAUDE_MODEL, ROLEPLAY_MODEL } from '../src/claude/runClaude.js';

describe('claudeArgs', () => {
  it('defaults the operator to the haiku model', () => {
    expect(CLAUDE_MODEL).toBe('haiku');
  });

  // Deliberately haiku, not a bigger model: sonnet/opus refuse to role-play either side of
  // the vishing scenario, so the call never resolves. The knob exists for experimentation.
  it('defaults the caller/victim role-players to the haiku model', () => {
    expect(ROLEPLAY_MODEL).toBe('haiku');
  });

  it('pins the chosen role-play model even on a resumed turn', () => {
    const args = claudeArgs({ systemPrompt: 'ignored', resume: 'sess-9', model: 'sonnet' });
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args).toContain('--resume');
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
