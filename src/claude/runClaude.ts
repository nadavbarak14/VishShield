import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

/** Model the OPERATOR (the orchestrator agent) reasons on. Defaults to Haiku — fast and
 *  cheap, and its structured decision-making holds up well there. Overridable with
 *  VISH_CLAUDE_MODEL (e.g. "sonnet" / "opus" / a full model id) without touching code. */
export const CLAUDE_MODEL = process.env.VISH_CLAUDE_MODEL ?? 'haiku';

/** Model the CALLER and VICTIM role-players run on, separate from the operator so they can be
 *  tuned independently. Defaults to Haiku — and that default is deliberate: the larger models
 *  (sonnet/opus) RECOGNISE the vishing pattern and refuse to play either side, even with the
 *  authorized-simulation framing ("I'm not going to role-play a social engineering attack").
 *  Haiku is the most willing to stay in character and let a call actually resolve. Overridable
 *  with VISH_ROLEPLAY_MODEL for experimentation (expect refusals on bigger models). */
export const ROLEPLAY_MODEL = process.env.VISH_ROLEPLAY_MODEL ?? 'haiku';

/** We spawn `claude` with cwd here (NOT the project dir) so the role-players don't inherit
 *  VishShield's CLAUDE.md, .claude/ hooks (e.g. the SessionStart skill injection), or git
 *  status. Combined with --system-prompt (replace) below, each call is a clean persona, not a
 *  coding agent that breaks character to talk about this repo. */
export const CLAUDE_CWD = tmpdir();

/** Pure builder for the `claude -p` argv, so the flags are testable without spawning.
 *  First turn (no `resume`) OWNS the system prompt via --system-prompt (full replace, so the
 *  default coding-agent persona is gone) and --exclude-dynamic-system-prompt-sections (drops
 *  cwd/env/git-status that would otherwise leak this repo into the persona). Later turns
 *  resume that session. Every invocation pins --model so runs never silently use a bigger
 *  model. NOTE: we avoid --bare — it forces API-key auth and breaks the Pro/Max subscription. */
export function claudeArgs(opts: { systemPrompt: string; resume?: string; model?: string }): string[] {
  const base = ['-p', '--output-format', 'json', '--model', opts.model ?? CLAUDE_MODEL];
  return opts.resume
    ? [...base, '--resume', opts.resume]
    : [...base, '--exclude-dynamic-system-prompt-sections', '--system-prompt', opts.systemPrompt];
}

/** Calls `claude -p` once and returns the assistant's text. Uses the logged-in
 *  subscription (no ANTHROPIC_API_KEY needed). Requires `claude` on PATH and a prior login.
 *  The user prompt is piped via STDIN (avoids argv length limits and flag-ordering ambiguity);
 *  the system prompt is passed as a flag. Verify flags against your installed CLI version. */
export function runClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      claudeArgs({ systemPrompt }),
      { stdio: ['pipe', 'pipe', 'pipe'], cwd: CLAUDE_CWD },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
      try {
        resolve(String(JSON.parse(stdout).result ?? '').trim());
      } catch {
        reject(new Error(`Failed to parse claude output: ${stdout.slice(0, 300)}`));
      }
    });
    child.stdin.write(userPrompt);
    child.stdin.end();
  });
}

export interface ClaudeSessionTurn {
  result: string;
  sessionId: string;
}

/** Like runClaude, but keeps a resumable session so a single Claude (e.g. one caller or one
 *  victim) retains its own memory across the turns of a call. First turn (no `resume`): set
 *  the persona/instructions via the (replaced) system prompt. Later turns: pass `--resume <id>`
 *  and only the newest line — the system prompt and history already live in the session.
 *  Runs on ROLEPLAY_MODEL (the caller/victim are the only users of this).
 *  Returns the session id. Live only (spawns `claude`); never used in CI. */
export function runClaudeSession(
  systemPrompt: string,
  userPrompt: string,
  resume?: string,
): Promise<ClaudeSessionTurn> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', claudeArgs({ systemPrompt, resume, model: ROLEPLAY_MODEL }), { stdio: ['pipe', 'pipe', 'pipe'], cwd: CLAUDE_CWD });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
      try {
        const j = JSON.parse(stdout);
        resolve({ result: String(j.result ?? '').trim(), sessionId: String(j.session_id ?? '') });
      } catch {
        reject(new Error(`Failed to parse claude output: ${stdout.slice(0, 300)}`));
      }
    });
    child.stdin.write(userPrompt);
    child.stdin.end();
  });
}
