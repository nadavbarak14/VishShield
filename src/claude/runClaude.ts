import { spawn } from 'node:child_process';

/** Model the agent/victim Claudes run on. Defaults to Haiku — fast and cheap, which is what
 *  we want for simulation runs and tests — and is overridable with VISH_CLAUDE_MODEL (e.g.
 *  "sonnet" / "opus" / a full model id) without touching code. */
export const CLAUDE_MODEL = process.env.VISH_CLAUDE_MODEL ?? 'haiku';

/** Pure builder for the `claude -p` argv, so the model flag is testable without spawning.
 *  First turn (no `resume`) sets the persona via --append-system-prompt; later turns resume an
 *  existing session. Every invocation pins --model so runs never silently use a bigger model. */
export function claudeArgs(opts: { systemPrompt: string; resume?: string; model?: string }): string[] {
  const base = ['-p', '--output-format', 'json', '--model', opts.model ?? CLAUDE_MODEL];
  return opts.resume
    ? [...base, '--resume', opts.resume]
    : [...base, '--append-system-prompt', opts.systemPrompt];
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
      { stdio: ['pipe', 'pipe', 'pipe'] },
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
 *  the persona/instructions via `--append-system-prompt`. Later turns: pass `--resume <id>`
 *  and only the newest line — the system prompt and history already live in the session.
 *  Returns the session id. Live only (spawns `claude`); never used in CI. */
export function runClaudeSession(
  systemPrompt: string,
  userPrompt: string,
  resume?: string,
): Promise<ClaudeSessionTurn> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', claudeArgs({ systemPrompt, resume }), { stdio: ['pipe', 'pipe', 'pipe'] });
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
