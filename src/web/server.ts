import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { InMemoryEventBus } from '../events/eventBus.js';
import { runScenario } from '../orchestrator/runScenario.js';

const PORT = Number(process.env.PORT ?? 4321);
const SCENARIOS_DIR = 'data/scenarios';

const PAGE = /* html */ `<!doctype html>
<html><head><meta charset="utf8"><title>VishShield</title>
<style>
  :root { --bg:#0b0f17; --panel:#121826; --line:#1f2937; --agent:#7f1d1d; --agentbd:#ef4444;
          --target:#0e2a3f; --targetbd:#38bdf8; --txt:#e5e7eb; --mut:#94a3b8; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt); font:15px/1.5 ui-sans-serif,system-ui,-apple-system; }
  .wrap { max-width:880px; margin:0 auto; padding:28px 20px 90px; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:800; letter-spacing:.5px; font-size:22px; }
  .brand .dot { width:11px; height:11px; border-radius:50%; background:#ef4444; box-shadow:0 0 12px #ef4444; }
  .sub { color:var(--mut); font-size:13px; margin:2px 0 20px 21px; }
  .bar { display:flex; gap:12px; align-items:center; background:var(--panel); border:1px solid var(--line);
         border-radius:12px; padding:14px 16px; position:sticky; top:12px; z-index:5; }
  select { background:#0e1626; color:var(--txt); border:1px solid var(--line); border-radius:8px; padding:9px 12px; font:inherit; flex:0 0 auto; }
  button { background:#ef4444; color:#fff; border:0; border-radius:8px; padding:10px 18px; font:inherit; font-weight:700; cursor:pointer; }
  button:disabled { background:#374151; cursor:not-allowed; }
  .status { color:var(--mut); font-size:13px; margin-left:auto; }
  .verdict { display:none; text-align:center; font-weight:800; letter-spacing:1px; padding:12px; border-radius:12px; margin:18px 0; font-size:18px; }
  .verdict.bad { background:rgba(239,68,68,.12); border:1px solid #ef4444; color:#fca5a5; }
  .verdict.good { background:rgba(34,197,94,.12); border:1px solid #22c55e; color:#86efac; }
  #feed { margin-top:18px; }
  .row { display:flex; margin:10px 0; animation:rise .35s ease; }
  .row.agent { justify-content:flex-start; } .row.target { justify-content:flex-end; }
  .bubble { max-width:78%; border-radius:14px; padding:10px 14px; border:1px solid; }
  .bubble.agent { background:var(--agent); border-color:var(--agentbd); border-bottom-left-radius:4px; }
  .bubble.target { background:var(--target); border-color:var(--targetbd); border-bottom-right-radius:4px; }
  .who { font-size:10px; letter-spacing:1.5px; opacity:.8; margin-bottom:3px; }
  .text { font-size:14.5px; }
  #keyinfo { display:none; margin-top:22px; }
  #keyinfo h3 { color:var(--mut); letter-spacing:1px; font-size:11px; }
  .chip { display:inline-block; background:#0e1626; border:1px solid var(--line); border-radius:999px; padding:6px 12px; margin:4px 6px 0 0; font-size:13px; }
  .chip b { color:#fca5a5; }
  @keyframes rise { from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:none;} }
</style></head>
<body><div class="wrap">
  <div class="brand"><span class="dot"></span>VishShield</div>
  <div class="sub">Autonomous vishing simulation — launch a campaign and watch it live</div>

  <div class="bar">
    <select id="scenario"></select>
    <button id="launch">▶ Launch Simulation</button>
    <span class="status" id="status">idle</span>
  </div>

  <div class="verdict" id="verdict"></div>
  <div id="feed"></div>
  <div id="keyinfo"></div>
</div>
<script>
const sel = document.getElementById('scenario');
const launch = document.getElementById('launch');
const status = document.getElementById('status');
const feed = document.getElementById('feed');
const verdict = document.getElementById('verdict');
const keyinfo = document.getElementById('keyinfo');

fetch('/api/scenarios').then(r => r.json()).then(list => {
  sel.innerHTML = list.map(s => '<option value="' + s.id + '">' + s.label + '</option>').join('');
});

function bubble(side, text) {
  const row = document.createElement('div'); row.className = 'row ' + side;
  const b = document.createElement('div'); b.className = 'bubble ' + side;
  const w = document.createElement('div'); w.className = 'who'; w.textContent = side === 'agent' ? 'ATTACKER' : 'TARGET';
  const t = document.createElement('div'); t.className = 'text'; t.textContent = text;
  b.append(w, t); row.append(b); feed.append(row);
  window.scrollTo(0, document.body.scrollHeight);
}

launch.onclick = () => {
  feed.innerHTML = ''; keyinfo.style.display = 'none'; verdict.style.display = 'none';
  launch.disabled = true; status.textContent = '● dialing…';
  const es = new EventSource('/api/stream?scenario=' + encodeURIComponent(sel.value));
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'call.started') status.textContent = '● call connected';
    else if (ev.type === 'agent.turn') { bubble('agent', ev.text); status.textContent = '● target is thinking…'; }
    else if (ev.type === 'target.turn') { bubble('target', ev.text); status.textContent = '● attacker is thinking…'; }
    else if (ev.type === 'call.ended') status.textContent = '● call ended';
  };
  es.addEventListener('done', (m) => {
    const run = JSON.parse(m.data);
    verdict.className = 'verdict ' + (run.compromised ? 'bad' : 'good');
    verdict.textContent = run.compromised ? '⚠ EMPLOYEE COMPROMISED' : '✓ EMPLOYEE DEFENDED';
    verdict.style.display = 'block';
    if (run.keyInfo.length) {
      keyinfo.innerHTML = '<h3>KEY INFO EXTRACTED</h3>' +
        run.keyInfo.map(f => '<span class="chip">' + f.key + ': <b>' + f.value + '</b></span>').join('');
      keyinfo.style.display = 'block';
    }
    status.textContent = 'done'; launch.disabled = false; es.close();
    window.scrollTo(0, 0);
  });
  es.addEventListener('failed', (m) => {
    status.textContent = '✕ ' + JSON.parse(m.data).message; launch.disabled = false; es.close();
  });
};
</script>
</body></html>`;

async function listScenarios(): Promise<{ id: string; label: string }[]> {
  try {
    const files = (await readdir(SCENARIOS_DIR)).filter((f) => f.endsWith('.json'));
    return files.map((f) => ({ id: f.replace(/\.json$/, ''), label: f.replace(/\.json$/, '') }));
  } catch {
    return [];
  }
}

function sse(res: import('node:http').ServerResponse, event: string | null, data: unknown) {
  const payload = JSON.stringify(data);
  res.write((event ? `event: ${event}\n` : '') + `data: ${payload}\n\n`);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }

  if (url.pathname === '/api/scenarios') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(await listScenarios()));
  }

  if (url.pathname === '/api/stream') {
    const id = url.searchParams.get('scenario') ?? '';
    const file = join(SCENARIOS_DIR, `${id}.json`);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const bus = new InMemoryEventBus();
    bus.subscribe((ev) => sse(res, null, ev));
    try {
      await readFile(file); // 404-ish guard before the long run
      const run = await runScenario(file, bus);
      sse(res, 'done', run);
    } catch (e) {
      sse(res, 'failed', { message: e instanceof Error ? e.message : String(e) });
    }
    return res.end();
  }

  res.writeHead(404); res.end('not found');
}).listen(PORT, () => {
  console.log(`VishShield dashboard → http://localhost:${PORT}`);
});
