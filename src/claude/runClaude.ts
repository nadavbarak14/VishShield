import { spawn } from 'node:child_process';

/** Calls `claude -p` once and returns the assistant's text. Uses the logged-in
 *  subscription (no ANTHROPIC_API_KEY needed). Requires `claude` on PATH and a prior login.
 *  The user prompt is piped via STDIN (avoids argv length limits and flag-ordering ambiguity);
 *  the system prompt is passed as a flag. Verify flags against your installed CLI version. */
export function runClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', '--output-format', 'json', '--append-system-prompt', systemPrompt],
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
    const args = resume
      ? ['-p', '--output-format', 'json', '--resume', resume]
      : ['-p', '--output-format', 'json', '--append-system-prompt', systemPrompt];
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
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
