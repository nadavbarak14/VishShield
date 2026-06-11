import { createServer } from 'node:http';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { InMemoryEventBus } from '../events/eventBus.js';
import { runScenario } from '../orchestrator/runScenario.js';

const PORT = Number(process.env.PORT ?? 4321);
const SCENARIOS_DIR = 'data/scenarios';
const LOG_DIR = 'data/eventlogs';

// The dashboard is PROCESS-FIRST: the hero column is the agent's step-by-step process
// (think → save memory → act); calls are tool-uses it places — possibly several in
// parallel — each rendered as a chip whose live transcript opens in the middle pane.
// The right rail keeps the calls list and the memory the agent saved.
const PAGE = /* html */ `<!doctype html>
<html><head><meta charset="utf8"><title>VishShield</title>
<style>
  :root { --bg:#0b0f17; --panel:#121826; --line:#1f2937; --agent:#7f1d1d; --agentbd:#ef4444;
          --target:#0e2a3f; --targetbd:#38bdf8; --txt:#e5e7eb; --mut:#94a3b8; --acc:#38bdf8; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt); font:15px/1.5 ui-sans-serif,system-ui,-apple-system; }
  .wrap { max-width:1760px; margin:0 auto; padding:22px 20px 60px; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:800; letter-spacing:.5px; font-size:22px; }
  .brand .dot { width:11px; height:11px; border-radius:50%; background:#ef4444; box-shadow:0 0 12px #ef4444; }
  .sub { color:var(--mut); font-size:13px; margin:2px 0 18px 21px; }
  .bar { display:flex; gap:12px; align-items:center; background:var(--panel); border:1px solid var(--line);
         border-radius:12px; padding:12px 16px; position:sticky; top:10px; z-index:5; }
  select { background:#0e1626; color:var(--txt); border:1px solid var(--line); border-radius:8px; padding:9px 12px; font:inherit; flex:0 0 auto; max-width:240px; }
  button { background:#ef4444; color:#fff; border:0; border-radius:8px; padding:10px 18px; font:inherit; font-weight:700; cursor:pointer; }
  button:disabled { background:#374151; cursor:not-allowed; }
  .status { color:var(--mut); font-size:13px; margin-left:auto; text-align:right; }
  .verdict { display:none; text-align:center; font-weight:800; letter-spacing:1px; padding:10px; border-radius:12px; margin:14px 0 0; font-size:17px; }
  .verdict.bad { background:rgba(239,68,68,.12); border:1px solid #ef4444; color:#fca5a5; }
  .verdict.good { background:rgba(34,197,94,.12); border:1px solid #22c55e; color:#86efac; }
  .verdict .chips { margin-top:6px; }
  .chip { display:inline-block; background:#0e1626; border:1px solid var(--line); border-radius:999px; padding:5px 12px; margin:4px 6px 0 0; font-size:13px; font-weight:400; letter-spacing:0; }
  .chip b { color:#fca5a5; }

  .layout { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,500px) 300px; grid-template-areas:"main tpane aside"; gap:16px; align-items:start; margin-top:16px; }
  .layout > main { grid-area:main; min-width:0; }
  #tpane { grid-area:tpane; } .layout > aside { grid-area:aside; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .ph { padding:10px 14px; font-size:11px; letter-spacing:1.5px; font-weight:800; color:var(--mut); border-bottom:1px solid var(--line); display:flex; align-items:center; gap:8px; }
  .empty { color:var(--mut); font-size:13px; padding:14px; }

  /* ── agent process timeline ─────────────────────────────────────────── */
  .colhead { font-size:11px; letter-spacing:1.5px; font-weight:800; color:var(--mut); margin:2px 0 10px 2px; }
  #steps { position:relative; padding-left:24px; }
  #steps::before { content:""; position:absolute; left:8px; top:8px; bottom:8px; width:2px; background:#1e3a5f; }
  .step { position:relative; margin:0 0 14px; padding:12px 14px; background:#0b1220; border:1px solid #1e3a5f; border-radius:10px; animation:rise .35s ease; }
  .step::before { content:""; position:absolute; left:-21px; top:17px; width:9px; height:9px; border-radius:50%; background:var(--acc); box-shadow:0 0 8px var(--acc); }
  .step h4 { margin:0 0 6px; font-size:11px; letter-spacing:1.5px; color:#7dd3fc; }
  .step .saved { display:flex; gap:8px; margin:0 0 10px; padding:8px 10px; background:rgba(125,211,252,.06); border:1px dashed #1e3a5f; border-radius:8px; font-size:13px; color:#cbd5e1; }
  .step .saved .ic { flex:0 0 auto; }
  .step .act { font-size:13.5px; font-weight:700; margin-bottom:2px; }
  .step .act.stop { color:#86efac; } .step .act.recall { color:#e2e8f0; }
  .toolrow { margin-top:8px; border:1px solid var(--line); border-radius:9px; background:#0e1626; padding:9px 11px; cursor:pointer; transition:border-color .15s; }
  .toolrow:hover { border-color:#334155; }
  .toolrow .t1 { display:flex; align-items:center; gap:8px; font-weight:700; font-size:13.5px; }
  .toolrow .t1 small { color:var(--mut); font-weight:400; }
  .toolrow .meta { color:var(--mut); font-size:12px; margin-top:2px; }

  /* status pills shared by chips, calls list, transcript header */
  .st { margin-left:auto; flex:0 0 auto; font-size:10px; letter-spacing:1px; font-weight:800; padding:2px 8px; border-radius:999px; background:#334155; color:#cbd5e1; }
  .st.dialing { background:rgba(250,204,21,.15); color:#fde68a; }
  .st.live { background:rgba(56,189,248,.18); color:#7dd3fc; animation:pulse 1.4s ease infinite; }
  .st.leak { background:rgba(239,68,68,.18); color:#fca5a5; }
  .st.safe { background:rgba(34,197,94,.18); color:#86efac; }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.45;} }

  /* ── transcript pane ────────────────────────────────────────────────── */
  #tpane { position:sticky; top:76px; display:flex; flex-direction:column; max-height:calc(100vh - 96px); }
  #thead { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid var(--line); }
  #thead .n { width:26px; height:26px; flex:0 0 auto; display:grid; place-items:center; border-radius:50%; background:#ef4444; color:#fff; font-weight:800; font-size:12px; }
  #thead .who { font-weight:700; font-size:14px; min-width:0; }
  #thead .who small { display:block; color:var(--mut); font-weight:400; font-size:11.5px; }
  #tbody { overflow-y:auto; padding:10px 14px 14px; flex:1; }
  .row { display:flex; margin:10px 0; animation:rise .35s ease; }
  .row.agent { justify-content:flex-start; } .row.target { justify-content:flex-end; }
  .bubble { max-width:82%; border-radius:14px; padding:9px 13px; border:1px solid; }
  .bubble.agent { background:var(--agent); border-color:var(--agentbd); border-bottom-left-radius:4px; }
  .bubble.target { background:var(--target); border-color:var(--targetbd); border-bottom-right-radius:4px; }
  .who2 { font-size:10px; letter-spacing:1.5px; opacity:.8; margin-bottom:3px; }
  .text { font-size:14px; }
  .callend { display:flex; align-items:center; gap:10px; margin:14px 2px 4px; color:var(--mut); font-size:11px; letter-spacing:1px; font-weight:700; text-transform:uppercase; }
  .callend::before, .callend::after { content:""; flex:1; height:1px; background:var(--line); }
  .callend.hangup { color:#fca5a5; }
  .callend.hangup::before, .callend.hangup::after { background:rgba(239,68,68,.3); }

  /* ── right rail: calls + memory ─────────────────────────────────────── */
  aside { position:sticky; top:76px; display:flex; flex-direction:column; gap:16px; max-height:calc(100vh - 96px); }
  #callspanel, #memorypanel { display:flex; flex-direction:column; min-height:64px; }
  #callslist, #memlist { overflow-y:auto; }
  #callspanel { max-height:46%; } #memorypanel { flex:1; min-height:0; }
  .crow { display:flex; align-items:center; gap:9px; padding:9px 12px; border-bottom:1px solid var(--line); cursor:pointer; }
  .crow:last-child { border-bottom:0; }
  .crow:hover { background:#0e1626; }
  .crow.sel { background:#0e1626; box-shadow:inset 3px 0 0 var(--acc); }
  .crow .n { width:22px; height:22px; flex:0 0 auto; display:grid; place-items:center; border-radius:50%; background:#ef4444; color:#fff; font-weight:800; font-size:11px; }
  .crow .mid { min-width:0; flex:1; }
  .crow .nm { font-weight:700; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .crow .pv { color:var(--mut); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .mem { padding:9px 12px; border-bottom:1px solid var(--line); font-size:12.5px; color:#cbd5e1; }
  .mem:last-child { border-bottom:0; }
  .mem .when { color:#7dd3fc; font-size:10px; letter-spacing:1px; font-weight:800; margin-bottom:2px; }

  @keyframes rise { from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:none;} }
  /* mid widths: process stays the hero on the left; transcript + calls + memory stack on the right */
  @media (max-width:1380px) {
    .layout { grid-template-columns:minmax(0,1fr) minmax(300px,420px); grid-template-areas:"main tpane" "main aside"; }
    #tpane, aside { position:static; max-height:none; }
    #tbody { max-height:46vh; }
    #callspanel, #memorypanel { max-height:none; }
    #callslist, #memlist { max-height:30vh; }
  }
  @media (max-width:900px) {
    .layout { grid-template-columns:1fr; grid-template-areas:"main" "tpane" "aside"; }
  }
</style></head>
<body><div class="wrap">
  <div class="brand"><span class="dot"></span>VishShield</div>
  <div class="sub">Autonomous vishing simulation — watch the agent run the operation; calls are just one of its tools</div>

  <div class="bar">
    <select id="scenario"></select>
    <button id="launch">▶ Launch Simulation</button>
    <select id="runs" title="Reopen a past or in-progress run"><option value="">⤺ reopen run…</option></select>
    <span class="status" id="status">idle</span>
  </div>

  <div class="verdict" id="verdict"></div>

  <div class="layout">
    <main>
      <div class="colhead">🧠 AGENT PROCESS</div>
      <div id="steps"></div>
      <div class="empty" id="stepsEmpty">Launch a simulation to watch the agent think, save memory, and place calls.</div>
    </main>

    <section class="panel" id="tpane">
      <div id="thead"><div class="ph" style="border:0;padding:0;">📞 TRANSCRIPT</div></div>
      <div id="tbody"><div class="empty">No call selected.</div></div>
    </section>

    <aside>
      <div class="panel" id="callspanel">
        <div class="ph">📋 CALLS</div>
        <div id="callslist"><div class="empty">No calls yet.</div></div>
      </div>
      <div class="panel" id="memorypanel">
        <div class="ph">💾 MEMORY SAVED</div>
        <div id="memlist"><div class="empty">Nothing saved yet.</div></div>
      </div>
    </aside>
  </div>
</div>
<script>
const sel = document.getElementById('scenario');
const launch = document.getElementById('launch');
const status = document.getElementById('status');
const verdict = document.getElementById('verdict');
const stepsEl = document.getElementById('steps');
const stepsEmpty = document.getElementById('stepsEmpty');
const thead = document.getElementById('thead');
const tbody = document.getElementById('tbody');
const callslist = document.getElementById('callslist');
const memlist = document.getElementById('memlist');

fetch('/api/scenarios').then(r => r.json()).then(list => {
  sel.innerHTML = list.map(s => '<option value="' + s.id + '">' + s.label + '</option>').join('');
});

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ── state ──────────────────────────────────────────────────────────────────
let calls, callsByConv, pendingChips, selectedKey, pinned;
function resetState() {
  calls = new Map();        // key -> call record
  callsByConv = new Map();  // synthetic calls for hop-less runs
  pendingChips = [];        // decision chips waiting for their hop.started
  selectedKey = null;
  pinned = false;           // user clicked a specific call → stop auto-following
  stepsEl.innerHTML = ''; callslist.innerHTML = '<div class="empty">No calls yet.</div>';
  memlist.innerHTML = '<div class="empty">Nothing saved yet.</div>';
  tbody.innerHTML = '<div class="empty">No call selected.</div>';
  renderTHead(null);
  stepsEmpty.style.display = '';
  verdict.style.display = 'none';
}

function clearEmpty(container) {
  const e = container.querySelector('.empty');
  if (e) e.remove();
}

// ── status pills ───────────────────────────────────────────────────────────
function pillState(c) {
  if (c.leaked === true) return { cls: 'leak', label: 'SECRET LEAKED' };
  if (c.status === 'ended') {
    if (c.leaked === false) return { cls: 'safe', label: 'NO LEAK' };
    return { cls: '', label: c.endedReason === 'target_hung_up' ? 'HUNG UP' : 'ENDED' };
  }
  if (c.status === 'live') return { cls: 'live', label: 'LIVE' };
  return { cls: 'dialing', label: 'DIALING' };
}
function refreshPills(c) {
  const s = pillState(c);
  for (const p of c.pills) { p.className = 'st ' + s.cls; p.textContent = s.label; }
  if (selectedKey === c.key) renderTHead(c);
}

// ── transcript pane ────────────────────────────────────────────────────────
function renderTHead(c) {
  thead.innerHTML = '';
  if (!c) { thead.append(el('div', 'ph', '📞 TRANSCRIPT')); thead.lastChild.style.cssText = 'border:0;padding:0;'; return; }
  thead.append(el('div', 'n', c.hopId ? String(c.hopId) : '•'));
  const who = el('div', 'who', c.name);
  if (c.title) who.append(el('small', null, c.title));
  thead.append(who);
  const s = pillState(c);
  thead.append(el('span', 'st ' + s.cls, s.label));
}

function bubbleNode(side, text) {
  const row = el('div', 'row ' + side);
  const b = el('div', 'bubble ' + side);
  b.append(el('div', 'who2', side === 'agent' ? 'CALLER' : 'TARGET'), el('div', 'text', text));
  row.append(b);
  return row;
}
function endNode(reason) {
  const label = reason === 'target_hung_up' ? '☎ target hung up'
    : reason === 'agent_ended' ? '☎ caller ended the call'
    : reason === 'max_turns' ? '☎ call cut off (turn limit)' : '☎ call ended';
  return el('div', 'callend' + (reason === 'target_hung_up' ? ' hangup' : ''), label);
}
function turnNode(t) { return t.kind === 'end' ? endNode(t.reason) : bubbleNode(t.side, t.text); }

function select(key) {
  selectedKey = key;
  const c = calls.get(key);
  for (const other of calls.values()) if (other.rowEl) other.rowEl.classList.toggle('sel', other.key === key);
  renderTHead(c);
  tbody.innerHTML = '';
  if (!c || c.turns.length === 0) tbody.append(el('div', 'empty', c && c.status === 'dialing' ? 'Ringing…' : 'No call selected.'));
  else for (const t of c.turns) tbody.append(turnNode(t));
  tbody.scrollTop = tbody.scrollHeight;
}

// ── calls (created by hop.started, or synthetically for hop-less runs) ─────
function addCall(key, hopId, personId, name, title) {
  clearEmpty(callslist);
  const c = { key, hopId, personId, name, title, status: 'dialing', endedReason: null, leaked: null, turns: [], pills: [], rowEl: null, pvEl: null };
  calls.set(key, c);

  const row = el('div', 'crow');
  row.append(el('div', 'n', hopId ? String(hopId) : '•'));
  const mid = el('div', 'mid');
  mid.append(el('div', 'nm', name + (title ? ' — ' + title : '')));
  c.pvEl = el('div', 'pv', 'dialing…');
  mid.append(c.pvEl);
  row.append(mid);
  const pill = el('span', 'st'); c.pills.push(pill); row.append(pill);
  row.onclick = () => { pinned = true; select(key); };
  c.rowEl = row;
  callslist.append(row);

  // bind the first decision chip waiting on this person
  const i = pendingChips.findIndex(p => p.personId === personId);
  if (i !== -1) {
    const chip = pendingChips.splice(i, 1)[0];
    chip.nameEl.textContent = '📞 ' + name + ' ';
    if (title) chip.nameEl.append(el('small', null, title));
    c.pills.push(chip.pillEl);
    chip.el.onclick = () => { pinned = true; select(key); };
  }

  refreshPills(c);
  if (!pinned) select(key);
  return c;
}

function callForConv(convId) {
  const i = convId.lastIndexOf('-hop-');
  if (i !== -1) {
    const c = calls.get('h' + convId.slice(i + 5));
    if (c) return c;
  }
  let c = callsByConv.get(convId);
  if (!c) {
    // single-call scenario: no operator, no hops — synthesize one call + one step
    c = addCall('c:' + convId, null, null, 'Direct call', '');
    callsByConv.set(convId, c);
    const step = stepCard('CALL');
    const chip = makeChip('📞 Direct call', null, c);
    step.append(chip.el);
    c.pills.push(chip.pillEl);
    chip.el.onclick = () => { pinned = true; select(c.key); };
    refreshPills(c);
  }
  return c;
}

// ── agent process timeline ─────────────────────────────────────────────────
function stepCard(label) {
  stepsEmpty.style.display = 'none';
  const step = el('div', 'step');
  step.append(el('h4', null, label));
  stepsEl.append(step);
  step.scrollIntoView({ block: 'nearest' });
  return step;
}

function makeChip(name, order, _call) {
  const chip = el('div', 'toolrow');
  const t1 = el('div', 't1');
  const nameEl = el('span', null, name);
  const pillEl = el('span', 'st', 'QUEUED');
  t1.append(nameEl, pillEl);
  chip.append(t1);
  if (order) {
    chip.append(el('div', 'meta', 'As: ' + order.persona));
    chip.append(el('div', 'meta', 'Goal: ' + order.objective.description));
    if (order.tactics && order.tactics.length) chip.append(el('div', 'meta', 'Tactics: ' + order.tactics.join(', ')));
  }
  return { el: chip, nameEl, pillEl };
}

function renderDecision(ev) {
  const step = stepCard('🧠 AGENT · STEP ' + (ev.seq + 1));
  if (ev.important) {
    const saved = el('div', 'saved');
    saved.append(el('span', 'ic', '💾'));
    const body = el('div');
    body.append(el('div', null, ev.important));
    saved.append(body);
    step.append(saved);
    clearEmpty(memlist);
    const m = el('div', 'mem');
    m.append(el('div', 'when', 'STEP ' + (ev.seq + 1)), el('div', null, ev.important));
    memlist.append(m);
    memlist.scrollTop = memlist.scrollHeight;
  }
  const a = ev.action;
  if (a.type === 'call') {
    step.append(el('div', 'act', a.calls.length > 1 ? '⚡ Places ' + a.calls.length + ' calls in parallel' : 'Places a call'));
    for (const order of a.calls) {
      const chip = makeChip('📞 ' + order.personId + ' ', order);
      step.append(chip.el);
      pendingChips.push({ personId: order.personId, el: chip.el, nameEl: chip.nameEl, pillEl: chip.pillEl });
    }
  } else if (a.type === 'recall') {
    step.append(el('div', 'act recall', '🔁 Re-reads the full transcript of call ' + a.hopId));
  } else {
    step.append(el('div', 'act stop', '🏁 Stops — ' + (a.reason || 'ending')));
  }
}

// ── event routing ──────────────────────────────────────────────────────────
function liveCallCount() {
  let n = 0;
  for (const c of calls.values()) if (c.status !== 'ended') n++;
  return n;
}
function setStatus() {
  const n = liveCallCount();
  status.textContent = n > 0 ? '● ' + n + ' call' + (n > 1 ? 's' : '') + ' in progress' : '● agent thinking…';
}

function render(ev) {
  if (ev.type === 'operator.decision') {
    renderDecision(ev);
    status.textContent = ev.action.type === 'stop' ? '● agent stopped' : '● agent acting…';
  } else if (ev.type === 'hop.started') {
    addCall('h' + ev.hopId, ev.hopId, ev.personId, ev.name, ev.title);
    setStatus();
  } else if (ev.type === 'call.started') {
    const c = callForConv(ev.conversationId);
    c.status = 'live'; refreshPills(c); setStatus();
    if (selectedKey === c.key && c.turns.length === 0) { tbody.innerHTML = ''; }
  } else if (ev.type === 'agent.turn' || ev.type === 'target.turn') {
    const side = ev.type === 'agent.turn' ? 'agent' : 'target';
    const c = callForConv(ev.conversationId);
    if (c.status === 'dialing') { c.status = 'live'; refreshPills(c); }
    c.turns.push({ kind: 'turn', side, text: ev.text });
    c.pvEl.textContent = (side === 'agent' ? 'caller: ' : 'them: ') + ev.text;
    if (selectedKey === c.key) {
      clearEmpty(tbody);
      tbody.append(bubbleNode(side, ev.text));
      tbody.scrollTop = tbody.scrollHeight;
    }
    setStatus();
  } else if (ev.type === 'call.ended') {
    const c = callForConv(ev.conversationId);
    c.status = 'ended'; c.endedReason = ev.reason;
    c.turns.push({ kind: 'end', reason: ev.reason });
    c.pvEl.textContent = ev.reason === 'target_hung_up' ? 'target hung up' : 'call ended';
    if (selectedKey === c.key) { tbody.append(endNode(ev.reason)); tbody.scrollTop = tbody.scrollHeight; }
    refreshPills(c); setStatus();
  } else if (ev.type === 'hop.ended') {
    const c = calls.get('h' + ev.hopId);
    if (c) { c.leaked = ev.leaked; refreshPills(c); }
  }
}

function showVerdict(run) {
  verdict.className = 'verdict ' + (run.compromised ? 'bad' : 'good');
  verdict.textContent = run.compromised ? '⚠ TARGET COMPROMISED' : '✓ TARGET DEFENDED';
  if (run.keyInfo && run.keyInfo.length) {
    const chips = el('div', 'chips');
    for (const f of run.keyInfo) {
      const chip = el('span', 'chip');
      chip.append(f.key + ': ');
      chip.append(el('b', null, f.value));
      chips.append(chip);
    }
    verdict.append(chips);
  }
  verdict.style.display = 'block';
}

// ── run plumbing (launch / reopen / SSE replay+tail) ───────────────────────
const runsSel = document.getElementById('runs');
let es = null;

function connect(runId) {
  if (es) es.close();
  localStorage.setItem('vish_run', runId);
  if (runsSel.value !== runId) runsSel.value = runId;
  es = new EventSource('/api/stream?run=' + encodeURIComponent(runId));
  // Every (re)connection replays the full log from the start, so reset on open to
  // rebuild cleanly — this also makes browser auto-reconnect idempotent.
  es.onopen = () => { resetState(); status.textContent = '● streaming…'; };
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

resetState();
loadRuns();
// Deep-link: /?run=<id> opens that run (replay + live tail); otherwise resume the last one.
const wanted = new URLSearchParams(location.search).get('run') || localStorage.getItem('vish_run');
if (wanted) connect(wanted);
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
