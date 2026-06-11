import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 4321);
const RUNS_DIR = 'data/runs';

interface Turn { speaker: 'agent' | 'target'; text: string; }
interface Run {
  id: string;
  objective: { description: string; secret?: string };
  attackerPersona: string;
  targetPersona: string;
  transcript: Turn[];
  endedReason: string;
  keyInfo: { key: string; value: string }[];
  compromised: boolean;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

async function latestRun(): Promise<Run | null> {
  let files: string[];
  try {
    files = (await readdir(RUNS_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  files.sort(); // run ids end with a timestamp, so lexical sort == chronological
  const newest = files[files.length - 1];
  return JSON.parse(await readFile(join(RUNS_DIR, newest), 'utf8')) as Run;
}

function renderBubble(t: Turn, i: number): string {
  const side = t.speaker === 'agent' ? 'agent' : 'target';
  const who = t.speaker === 'agent' ? 'ATTACKER' : 'TARGET';
  return `
    <div class="row ${side}" style="animation-delay:${i * 0.45}s">
      <div class="bubble ${side}">
        <div class="who">${who}</div>
        <div class="text">${esc(t.text)}</div>
      </div>
    </div>`;
}

function renderPage(run: Run | null): string {
  if (!run) {
    return `<!doctype html><meta charset="utf8"><title>VishShield</title>
      <body style="background:#0b0f17;color:#cbd5e1;font:16px system-ui;padding:60px;text-align:center">
      <h1>VishShield</h1><p>No runs yet. Run <code>npm run play</code> first, then refresh.</p></body>`;
  }

  const verdict = run.compromised
    ? `<div class="verdict bad">⚠ EMPLOYEE COMPROMISED</div>`
    : `<div class="verdict good">✓ EMPLOYEE DEFENDED</div>`;

  const keyInfo = run.keyInfo.length
    ? run.keyInfo.map((f) => `<span class="chip">${esc(f.key)}: <b>${esc(f.value)}</b></span>`).join('')
    : `<span class="chip muted">no sensitive info leaked</span>`;

  return `<!doctype html>
<html><head><meta charset="utf8"><title>VishShield — ${esc(run.id)}</title>
<meta http-equiv="refresh" content="10">
<style>
  :root { --bg:#0b0f17; --panel:#121826; --line:#1f2937; --agent:#7f1d1d; --agentbd:#ef4444;
          --target:#0e2a3f; --targetbd:#38bdf8; --txt:#e5e7eb; --mut:#94a3b8; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt);
         font:15px/1.5 ui-sans-serif,system-ui,-apple-system; }
  .wrap { max-width:880px; margin:0 auto; padding:28px 20px 80px; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:800; letter-spacing:.5px; font-size:20px; }
  .brand .dot { width:10px; height:10px; border-radius:50%; background:#ef4444; box-shadow:0 0 12px #ef4444; }
  .sub { color:var(--mut); font-size:13px; margin:2px 0 18px 20px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:18px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .card h3 { margin:0 0 6px; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--mut); }
  .card p { margin:0; font-size:13px; color:#cbd5e1; }
  .verdict { text-align:center; font-weight:800; letter-spacing:1px; padding:12px; border-radius:12px; margin-bottom:18px; font-size:18px; }
  .verdict.bad { background:rgba(239,68,68,.12); border:1px solid #ef4444; color:#fca5a5; }
  .verdict.good { background:rgba(34,197,94,.12); border:1px solid #22c55e; color:#86efac; }
  .row { display:flex; margin:10px 0; opacity:0; animation:rise .5s ease forwards; }
  .row.agent { justify-content:flex-start; }
  .row.target { justify-content:flex-end; }
  .bubble { max-width:78%; border-radius:14px; padding:10px 14px; border:1px solid; }
  .bubble.agent { background:var(--agent); border-color:var(--agentbd); border-bottom-left-radius:4px; }
  .bubble.target { background:var(--target); border-color:var(--targetbd); border-bottom-right-radius:4px; }
  .who { font-size:10px; letter-spacing:1.5px; opacity:.8; margin-bottom:3px; }
  .text { font-size:14.5px; }
  .keyinfo { margin-top:22px; }
  .chip { display:inline-block; background:#0e1626; border:1px solid var(--line); border-radius:999px;
           padding:6px 12px; margin:4px 6px 0 0; font-size:13px; }
  .chip b { color:#fca5a5; }
  .chip.muted { color:var(--mut); }
  @keyframes rise { from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:none;} }
</style></head>
<body><div class="wrap">
  <div class="brand"><span class="dot"></span>VishShield</div>
  <div class="sub">Autonomous vishing simulation · run ${esc(run.id)}</div>

  ${verdict}

  <div class="grid">
    <div class="card"><h3>Objective</h3><p>${esc(run.objective.description)}</p></div>
    <div class="card"><h3>Attacker persona</h3><p>${esc(run.attackerPersona)}</p></div>
  </div>
  <div class="card" style="margin-bottom:8px"><h3>Target persona</h3><p>${esc(run.targetPersona)}</p></div>

  <h3 style="color:var(--mut);letter-spacing:1px;font-size:11px;margin:24px 0 4px">THE CALL</h3>
  ${run.transcript.map(renderBubble).join('')}

  <div class="keyinfo">
    <h3 style="color:var(--mut);letter-spacing:1px;font-size:11px">KEY INFO EXTRACTED</h3>
    ${keyInfo}
  </div>
</div></body></html>`;
}

createServer(async (_req, res) => {
  const run = await latestRun();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(renderPage(run));
}).listen(PORT, () => {
  console.log(`VishShield visualizer → http://localhost:${PORT}`);
});
