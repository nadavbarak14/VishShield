import { createServer } from 'node:http';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { InMemoryEventBus } from '../events/eventBus.js';
import { runScenario } from '../orchestrator/runScenario.js';

const PORT = Number(process.env.PORT ?? 4321);
const SCENARIOS_DIR = 'data/scenarios';
const LOG_DIR = 'data/eventlogs';

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
    <select id="runs" title="Reopen a past or in-progress run"><option value="">⤺ reopen run…</option></select>
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

const runsSel = document.getElementById('runs');
let es = null;          // current EventSource
let activeRun = null;   // current run id

function render(ev) {
  if (ev.type === 'operator.decision') { opBlock(ev); status.textContent = '● orchestrator deciding…'; }
  else if (ev.type === 'hop.started') { newCall(ev.hopId, ev.name, ev.title); status.textContent = '● call ' + ev.hopId + ' · dialing ' + ev.name + '…'; }
  else if (ev.type === 'call.started') status.textContent = '● call connected';
  else if (ev.type === 'agent.turn') { bubble('agent', ev.text); status.textContent = '● victim is thinking…'; }
  else if (ev.type === 'target.turn') { bubble('target', ev.text); status.textContent = '● attacker is thinking…'; }
  else if (ev.type === 'call.ended') status.textContent = '● call ended';
  else if (ev.type === 'hop.ended') endCall(ev.leaked);
}

function showVerdict(run) {
  verdict.className = 'verdict ' + (run.compromised ? 'bad' : 'good');
  verdict.textContent = run.compromised ? '⚠ TARGET COMPROMISED' : '✓ TARGET DEFENDED';
  verdict.style.display = 'block';
  if (run.keyInfo && run.keyInfo.length) {
    keyinfo.innerHTML = '<h3>KEY INFO EXTRACTED</h3>' +
      run.keyInfo.map(f => '<span class="chip">' + f.key + ': <b>' + f.value + '</b></span>').join('');
    keyinfo.style.display = 'block';
  }
}

// Connect (or reconnect) to a run by id and replay its whole log, then live-tail.
function connect(runId) {
  if (es) es.close();
  activeRun = runId;
  localStorage.setItem('vish_run', runId);
  if (runsSel.value !== runId) runsSel.value = runId;
  es = new EventSource('/api/stream?run=' + encodeURIComponent(runId));
  // Every (re)connection replays the full log from the start, so clear on open to
  // rebuild cleanly — this also makes browser auto-reconnect idempotent.
  es.onopen = () => {
    feed.innerHTML = ''; cur = null; curHead = null;
    verdict.style.display = 'none'; keyinfo.style.display = 'none';
    status.textContent = '● streaming…';
  };
  es.onmessage = (m) => render(JSON.parse(m.data));
  es.addEventListener('done', (m) => { showVerdict(JSON.parse(m.data)); status.textContent = 'done'; es.close(); window.scrollTo(0, 0); });
  es.addEventListener('failed', (m) => { status.textContent = '✕ ' + JSON.parse(m.data).message; es.close(); });
}

function loadRuns(selectId) {
  fetch('/api/runs').then(r => r.json()).then(list => {
    runsSel.innerHTML = '<option value="">⤺ reopen run…</option>' +
      list.map(r => '<option value="' + r.id + '">' + r.id + '</option>').join('');
    if (selectId) runsSel.value = selectId;
  });
}

launch.onclick = () => {
  status.textContent = '● launching…';
  fetch('/api/launch?scenario=' + encodeURIComponent(sel.value))
    .then(r => r.json())
    .then(({ id, error }) => {
      if (error) { status.textContent = '✕ ' + error; return; }
      connect(id);
      loadRuns(id);
    });
};

runsSel.onchange = () => { if (runsSel.value) connect(runsSel.value); };

// On (re)load, resume the last run so a refresh never loses the conversation.
loadRuns();
const saved = localStorage.getItem('vish_run');
if (saved) connect(saved);
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

type Res = import('node:http').ServerResponse;

function sse(res: Res, event: string | null, data: unknown) {
  if (res.writableEnded) return;
  try {
    res.write((event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* client went away mid-write — ignore */
  }
}

// ---- Stateful run registry -------------------------------------------------
// Each launched run is recorded as an ordered event log kept in memory (for live
// replay) and flushed to disk on completion (durable across server restarts). A
// (re)connecting client replays the WHOLE log before tailing live, so a page
// refresh never loses the conversation.
interface LiveRun {
  id: string;
  scenario: string;
  events: unknown[];
  status: 'running' | 'done' | 'failed';
  result?: unknown;
  error?: string;
  listeners: Set<Res>;
}
const liveRuns = new Map<string, LiveRun>();

function startRun(scenario: string): LiveRun {
  const id = `${scenario}-${Date.now()}`;
  const run: LiveRun = { id, scenario, events: [], status: 'running', listeners: new Set() };
  liveRuns.set(id, run);

  (async () => {
    const bus = new InMemoryEventBus();
    bus.subscribe((ev) => {
      run.events.push(ev);
      for (const res of run.listeners) sse(res, null, ev);
    });
    try {
      run.result = await runScenario(join(SCENARIOS_DIR, `${scenario}.json`), bus);
      run.status = 'done';
    } catch (e) {
      run.status = 'failed';
      run.error = e instanceof Error ? e.message : String(e);
    }
    // flush the full ordered log to disk (single write — no interleaving)
    try {
      await mkdir(LOG_DIR, { recursive: true });
      const lines = run.events.map((e) => JSON.stringify(e));
      lines.push(JSON.stringify(
        run.status === 'done' ? { __terminal: 'done', result: run.result } : { __terminal: 'failed', message: run.error },
      ));
      await writeFile(join(LOG_DIR, `${id}.jsonl`), lines.join('\n') + '\n');
    } catch { /* best-effort persistence */ }
    for (const res of run.listeners) {
      if (run.status === 'done') sse(res, 'done', run.result);
      else sse(res, 'failed', { message: run.error });
      res.end();
    }
    run.listeners.clear();
  })();

  return run;
}

async function loadRunFromDisk(id: string): Promise<LiveRun | undefined> {
  try {
    const raw = await readFile(join(LOG_DIR, `${id}.jsonl`), 'utf8');
    const run: LiveRun = { id, scenario: id.replace(/-\d+$/, ''), events: [], status: 'running', listeners: new Set() };
    for (const line of raw.split('\n').filter(Boolean)) {
      const item = JSON.parse(line) as Record<string, unknown>;
      if (item.__terminal === 'done') { run.status = 'done'; run.result = item.result; }
      else if (item.__terminal === 'failed') { run.status = 'failed'; run.error = String(item.message ?? ''); }
      else run.events.push(item);
    }
    return run;
  } catch {
    return undefined;
  }
}

async function listRuns(): Promise<{ id: string; scenario: string }[]> {
  const ids = new Set<string>();
  for (const id of liveRuns.keys()) ids.add(id);
  try {
    for (const f of await readdir(LOG_DIR)) if (f.endsWith('.jsonl')) ids.add(f.replace(/\.jsonl$/, ''));
  } catch { /* no logs yet */ }
  return [...ids].sort().reverse().map((id) => ({ id, scenario: id.replace(/-\d+$/, '') }));
}

function streamRun(res: Res, run: LiveRun) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  // Synchronous from here: no await, so no live event can interleave before we subscribe.
  for (const ev of run.events) sse(res, null, ev);
  if (run.status === 'done') { sse(res, 'done', run.result); return res.end(); }
  if (run.status === 'failed') { sse(res, 'failed', { message: run.error }); return res.end(); }
  run.listeners.add(res);
  res.on('close', () => run.listeners.delete(res));
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

  // Start a run server-side and return its id. The run keeps going regardless of
  // whether any browser is connected.
  if (url.pathname === '/api/launch') {
    const scenario = url.searchParams.get('scenario') ?? '';
    try {
      await readFile(join(SCENARIOS_DIR, `${scenario}.json`));
    } catch {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'unknown scenario' }));
    }
    const run = startRun(scenario);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id: run.id }));
  }

  // List runs (in-memory + persisted) so the UI can reopen any of them.
  if (url.pathname === '/api/runs') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(await listRuns()));
  }

  // Replay a run's full event log, then live-tail if it's still running.
  if (url.pathname === '/api/stream') {
    const runId = url.searchParams.get('run') ?? '';
    const run = liveRuns.get(runId) ?? (await loadRunFromDisk(runId));
    if (!run) { res.writeHead(404); return res.end('no such run'); }
    return streamRun(res, run);
  }

  res.writeHead(404); res.end('not found');
}).listen(PORT, () => {
  console.log(`VishShield dashboard → http://localhost:${PORT}`);
});
