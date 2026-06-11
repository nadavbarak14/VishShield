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
  /* operator (orchestrator) thinking block */
  .op { margin:22px 0 8px; padding:12px 14px; background:#0b1220; border:1px solid #1e3a5f; border-left:3px solid #38bdf8; border-radius:10px; animation:rise .35s ease; }
  .op h4 { margin:0 0 6px; font-size:11px; letter-spacing:1.5px; color:#7dd3fc; }
  .op .learned { font-size:13.5px; color:#cbd5e1; margin:0 0 8px; line-height:1.5; }
  .op .learned b { color:#7dd3fc; font-weight:600; }
  .op .decision { font-size:14px; }
  .op .decision .tag { display:inline-block; font-weight:800; font-size:11px; letter-spacing:1px; padding:2px 8px; border-radius:6px; margin-right:8px; }
  .op .decision.call .tag { background:#7f1d1d; color:#fecaca; }
  .op .decision.recall .tag { background:#334155; color:#e2e8f0; }
  .op .decision.stop .tag { background:#14532d; color:#bbf7d0; }
  .op .meta { color:var(--mut); font-size:12.5px; margin-top:4px; }
  /* collapsible per-call card */
  .call { margin:10px 0; border:1px solid var(--line); border-radius:12px; overflow:hidden; animation:rise .35s ease; }
  .call > .head { display:flex; align-items:center; gap:10px; padding:11px 14px; cursor:pointer; background:#0e1626; border-left:3px solid #ef4444; }
  .call > .head .n { width:24px; height:24px; flex:0 0 auto; display:grid; place-items:center; border-radius:50%; background:#ef4444; color:#fff; font-weight:800; font-size:12px; }
  .call > .head .who2 { font-weight:700; }
  .call > .head .who2 small { color:var(--mut); font-weight:400; margin-left:8px; }
  .call > .head .badge { margin-left:auto; font-size:11px; letter-spacing:1px; font-weight:800; padding:3px 9px; border-radius:999px; }
  .call > .head .badge.bad { background:rgba(239,68,68,.15); color:#fca5a5; }
  .call > .head .badge.good { background:rgba(34,197,94,.15); color:#86efac; }
  .call > .head .chev { color:var(--mut); transition:transform .2s; margin-left:10px; }
  .call.collapsed > .head .chev { transform:rotate(-90deg); }
  .call .callbody { padding:6px 14px 12px; }
  .call.collapsed .callbody { display:none; }
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

let cur = null;       // current call card body (where turns go)
let curHead = null;   // current call card header (where the result badge goes)

// 🧠 The orchestrator's thought process: what it took from the last call + its next move.
function opBlock(ev) {
  cur = null; curHead = null;   // a new decision closes the current call grouping
  const o = document.createElement('div'); o.className = 'op';
  const h = document.createElement('h4'); h.textContent = '🧠 ORCHESTRATOR · decision ' + (ev.seq + 1); o.append(h);
  if (ev.important) {
    const l = document.createElement('div'); l.className = 'learned';
    const b = document.createElement('b'); b.textContent = 'Read the last call → ';
    l.append(b, document.createTextNode(ev.important));
    o.append(l);
  }
  const a = ev.action;
  const d = document.createElement('div'); d.className = 'decision ' + a.type;
  const tag = document.createElement('span'); tag.className = 'tag';
  if (a.type === 'call') {
    tag.textContent = 'NEXT: CALL';
    d.append(tag, document.createTextNode('Call ' + a.personId));
    const m1 = document.createElement('div'); m1.className = 'meta'; m1.append(document.createTextNode('Pretext: ' + a.persona));
    const m2 = document.createElement('div'); m2.className = 'meta'; m2.append(document.createTextNode('Goal: ' + a.objective.description));
    const m3 = document.createElement('div'); m3.className = 'meta'; m3.textContent = 'Tactics: ' + (a.tactics || []).join(', ');
    d.append(m1, m2, m3);
  } else if (a.type === 'recall') {
    tag.textContent = 'RECALL';
    d.append(tag, document.createTextNode('Re-read the full transcript of call ' + a.hopId));
  } else {
    tag.textContent = 'STOP';
    d.append(tag, document.createTextNode(a.reason || 'ending'));
  }
  o.append(d); feed.append(o);
  window.scrollTo(0, document.body.scrollHeight);
}

function newCall(hopId, name, title) {
  const c = document.createElement('div'); c.className = 'call';
  const head = document.createElement('div'); head.className = 'head';
  const n = document.createElement('div'); n.className = 'n'; n.textContent = hopId || '•';
  const who = document.createElement('div'); who.className = 'who2';
  who.append(document.createTextNode('📞 ' + (name || 'Call')));
  if (title) { const s = document.createElement('small'); s.textContent = title; who.append(s); }
  const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '▾';
  head.append(n, who, chev);
  head.onclick = () => c.classList.toggle('collapsed');
  const body = document.createElement('div'); body.className = 'callbody';
  c.append(head, body); feed.append(c);
  cur = body; curHead = head;
  window.scrollTo(0, document.body.scrollHeight);
}

function bubble(side, text) {
  if (!cur) newCall(null, 'Call', '');   // scenario-a has no hop events — group its turns too
  const row = document.createElement('div'); row.className = 'row ' + side;
  const b = document.createElement('div'); b.className = 'bubble ' + side;
  const w = document.createElement('div'); w.className = 'who'; w.textContent = side === 'agent' ? 'ATTACKER' : 'TARGET';
  const t = document.createElement('div'); t.className = 'text'; t.textContent = text;
  b.append(w, t); row.append(b); cur.append(row);
  window.scrollTo(0, document.body.scrollHeight);
}

function endCall(leaked) {
  if (!curHead) return;
  const badge = document.createElement('span'); badge.className = 'badge ' + (leaked ? 'bad' : 'good');
  badge.textContent = leaked ? 'SECRET LEAKED' : 'NO LEAK';
  curHead.append(badge);
}

launch.onclick = () => {
  feed.innerHTML = ''; keyinfo.style.display = 'none'; verdict.style.display = 'none';
  cur = null; curHead = null;
  launch.disabled = true; status.textContent = '● dialing…';
  const es = new EventSource('/api/stream?scenario=' + encodeURIComponent(sel.value));
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'operator.decision') { opBlock(ev); status.textContent = '● orchestrator deciding…'; }
    else if (ev.type === 'hop.started') { newCall(ev.hopId, ev.name, ev.title); status.textContent = '● call ' + ev.hopId + ' · dialing ' + ev.name + '…'; }
    else if (ev.type === 'call.started') status.textContent = '● call connected';
    else if (ev.type === 'agent.turn') { bubble('agent', ev.text); status.textContent = '● victim is thinking…'; }
    else if (ev.type === 'target.turn') { bubble('target', ev.text); status.textContent = '● attacker is thinking…'; }
    else if (ev.type === 'call.ended') status.textContent = '● call ended';
    else if (ev.type === 'hop.ended') endCall(ev.leaked);
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
