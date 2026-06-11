import { createServer } from 'node:http';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { InMemoryEventBus } from '../events/eventBus.js';
import { runScenario } from '../orchestrator/runScenario.js';
import { runSession } from '../orchestrator/runSession.js';
import { loadOrg } from '../orchestrator/loadOrg.js';
import { listTactics } from '../orchestrator/loadTactics.js';

const PORT = Number(process.env.PORT ?? 4321);
const SCENARIOS_DIR = 'data/scenarios';
const LOG_DIR = 'data/eventlogs';

// ── VishShield Command Center ────────────────────────────────────────────────
// C&C-style console. THE PROCESS (center) is the hero: the operator's main
// thread — goal → 🧠 decision nodes → calls branching off as collapsible
// "side quest" cards → verdict. Calls never stream live: they show PROCESSING
// until the transcript lands. Left: scenario/tactics, worker tree (every worker
// clickable), exfil loot — all press-to-expand. Right: operation/worker dossier.
// Footer: a scrubber that replays the whole operation. Two modal overlays:
// a worker map (attack surface) and a scenario library (deploy surface).
//
// The client buffers the run's full event log (SSE replay+tail, unchanged
// server semantics) and renders EVERYTHING as a pure function of that buffer —
// so live runs and reopened runs share one code path. + NEW SESSION resets the
// console and opens the scenario library to deploy the next operation.
const PAGE = /* html */ `<!doctype html>
<html><head><meta charset="utf8"><title>VishShield · C&amp;C</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; }
  html, body { margin:0; height:100%; }
  body { background:#06090f; color:#e6eaf2; font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif; -webkit-font-smoothing:antialiased; }
  ::-webkit-scrollbar { width:9px; height:9px; }
  ::-webkit-scrollbar-thumb { background:#1b2b3f; border-radius:6px; }
  ::-webkit-scrollbar-track { background:transparent; }
  @keyframes vpulse { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:.3;transform:scale(.8);} }
  @keyframes vscan { 0%{transform:translateX(-110%);} 100%{transform:translateX(360%);} }
  @keyframes vflick { 0%,100%{opacity:1;} 48%{opacity:1;} 50%{opacity:.55;} 52%{opacity:1;} }
  @keyframes vdash { to{background-position:14px 0;} }
  @keyframes vfade { from{opacity:0;} to{opacity:1;} }
  @keyframes vpop { from{opacity:0;transform:translateY(10px) scale(.99);} to{opacity:1;transform:none;} }
  @keyframes vrise { from{opacity:0;transform:translateY(8px);} to{opacity:1;transform:none;} }

  .mono { font-family:'IBM Plex Mono',monospace; }
  #shell { height:100vh; min-width:1160px; display:grid; grid-template-rows:auto minmax(0,1fr); overflow:hidden;
    background-image:radial-gradient(circle at 50% -10%,rgba(56,189,248,.06),transparent 55%),
      linear-gradient(rgba(120,180,255,.022) 1px,transparent 1px),
      linear-gradient(90deg,rgba(120,180,255,.022) 1px,transparent 1px);
    background-size:auto,28px 28px,28px 28px; background-color:#06090f; }

  /* ── top bar ── */
  header { display:flex; align-items:center; gap:16px; padding:10px 18px; background:rgba(8,12,20,.85); border-bottom:1px solid #16283a; }
  .beacon { width:12px; height:12px; border-radius:3px; background:#ef4444; box-shadow:0 0 16px #ef4444; display:block; animation:vflick 4s infinite; }
  .brand { font-weight:700; font-size:16px; letter-spacing:2px; }
  .brand small { color:#8b98ae; font-weight:500; font-size:16px; }
  .cnc { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:2px; color:#38bdf8; border:1px solid rgba(56,189,248,.3); border-radius:5px; padding:2px 7px; }
  .tm { display:flex; align-items:center; gap:6px; font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:.5px; color:#8b98ae; border:1px solid #16283a; background:rgba(12,18,28,.6); border-radius:6px; padding:4px 9px; }
  .tm .k { color:#5d6b82; } .tm .v { color:#cdd6e4; }
  .clockbox { display:flex; align-items:center; gap:7px; font-family:'IBM Plex Mono',monospace; border-left:1px solid #16283a; padding-left:14px; }
  .clockbox .t { font-size:11px; color:#5d6b82; }
  #clock { font-size:14px; letter-spacing:1px; color:#e6eaf2; font-weight:500; }
  #statusPill { display:flex; align-items:center; gap:8px; padding:6px 12px; border-radius:8px; }
  #statusLine { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:1px; font-weight:500; }

  /* ── main grid ── */
  main { display:grid; grid-template-columns:288px minmax(440px,1fr) 372px; min-height:0; }
  aside.left  { border-right:1px solid #11202f; background:rgba(8,12,19,.6); overflow-y:auto; min-height:0; padding:14px 13px 24px; display:flex; flex-direction:column; gap:11px; }
  aside.left > .panel { flex:0 0 auto; }
  aside.right { border-left:1px solid #11202f; background:rgba(8,12,19,.6); overflow-y:auto; min-height:0; padding:14px 15px 26px; position:relative; }
  aside.right::after { content:""; position:absolute; top:8px; right:10px; width:13px; height:13px; border-right:2px solid rgba(56,189,248,.45); border-top:2px solid rgba(56,189,248,.45); }

  /* ── left accordion panels ── */
  .panel { border:1px solid #16283a; border-radius:11px; overflow:hidden; background:rgba(11,17,26,.7); }
  .panel.rd { border-color:#2a1f28; background:rgba(20,12,15,.5); }
  .phead { display:flex; align-items:center; gap:9px; padding:9px 10px 9px 12px; border-left:2px solid #38bdf8; }
  .panel.rd .phead { border-left-color:#ef4444; padding:11px 12px; }
  .ptoggle { display:flex; align-items:center; gap:9px; flex:1; min-width:0; cursor:pointer; }
  .chev { font-family:'IBM Plex Mono',monospace; font-size:10px; color:#5d6b82; display:inline-block; transition:transform .2s; }
  .chev.open { transform:rotate(90deg); }
  .plabel { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:1.5px; color:#bae6fd; }
  .panel.rd .plabel { color:#fca5a5; }
  .pcount { font-family:'IBM Plex Mono',monospace; font-size:9px; color:#5d6b82; }
  .pbtn { font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:1px; color:#7dd3fc; border:1px solid rgba(56,189,248,.35); background:rgba(56,189,248,.08); border-radius:6px; padding:5px 9px; cursor:pointer; flex:0 0 auto; }
  .pbody { padding:0 12px 13px; }
  .seclabel { font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:1.5px; color:#5d6b82; margin:13px 0 7px; }
  .seclabel:first-child { margin-top:0; }

  .scnrow { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:9px; border:1px solid #1c2638; background:#0c1220; margin-bottom:6px; cursor:default; }
  .scnrow.live { border-color:rgba(52,211,153,.4); background:rgba(52,211,153,.06); }
  .scnrow .dot { width:7px; height:7px; border-radius:50%; background:#475569; flex:0 0 auto; }
  .scnrow.live .dot { background:#34d399; animation:vpulse 1.6s infinite; box-shadow:0 0 8px #34d399; }
  .scnrow .id { font-family:'IBM Plex Mono',monospace; font-size:12px; color:#dbe2ee; }
  .scnrow .ds { font-size:10px; color:#7d8aa0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .scnrow .tag { font-family:'IBM Plex Mono',monospace; font-size:8.5px; letter-spacing:1px; color:#7d8aa0; border:1px solid #243049; border-radius:5px; padding:2px 6px; flex:0 0 auto; }
  .scnrow.live .tag { color:#34d399; border-color:rgba(52,211,153,.4); }

  .chips { display:flex; flex-wrap:wrap; gap:5px; }
  .tchip { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.2px; cursor:pointer; border-radius:6px; padding:5px 8px; border:1px solid rgba(239,68,68,.45); background:rgba(239,68,68,.1); color:#fca5a5; }
  .tchip.off { border-color:#202b3f; background:#0c1220; color:#566377; text-decoration:line-through; text-decoration-color:#33405a; }

  .runrow { display:flex; align-items:center; gap:8px; padding:6px 9px; border-radius:8px; border:1px solid transparent; cursor:pointer; font-family:'IBM Plex Mono',monospace; font-size:10.5px; color:#8b98ae; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .runrow:hover { background:#0c1220; border-color:#1c2638; }
  .runrow.sel { border-color:rgba(56,189,248,.5); background:rgba(56,189,248,.08); color:#bae6fd; }

  .orgcard { display:flex; align-items:center; gap:9px; padding:8px 10px; border:1px solid #16283a; background:rgba(14,20,33,.6); border-radius:9px; }
  .orgcard .ic { width:26px; height:26px; border-radius:7px; background:#0e1626; border:1px solid #243049; display:grid; place-items:center; font-size:12px; flex:0 0 auto; }
  .orgcard .nm { font-size:12.5px; font-weight:600; color:#dbe2ee; }
  .orgcard .mt { font-size:9.5px; color:#7d8aa0; font-family:'IBM Plex Mono',monospace; }
  .deptgrp { margin-left:12px; border-left:1px solid #1c2c40; padding-top:7px; }
  .depthead { display:flex; align-items:center; gap:7px; margin-bottom:5px; }
  .depthead .tick { width:12px; height:1px; background:#1c2c40; display:block; flex:0 0 auto; }
  .depthead .nm { font-size:10px; letter-spacing:1px; color:#8b98ae; text-transform:uppercase; font-weight:600; }
  .deptppl { margin-left:12px; border-left:1px solid #16242f; }
  .wrow { display:flex; align-items:center; }
  .wrow .tick { width:13px; height:1px; background:#16242f; display:block; flex:0 0 auto; }
  .wcard { flex:1; min-width:0; display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; border:1px solid transparent; cursor:pointer; }
  .wcard.sel { border-color:rgba(56,189,248,.5); background:rgba(56,189,248,.08); }
  .wcard .nm { font-size:12px; font-weight:600; color:#dbe2ee; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .wcard .tt { font-size:9.5px; color:#7d8aa0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .treehint { font-size:9.5px; color:#475569; font-family:'IBM Plex Mono',monospace; letter-spacing:.5px; margin:9px 0 0 12px; }

  .lootrow { display:flex; align-items:center; gap:9px; background:rgba(239,68,68,.08); border:1px solid rgba(239,68,68,.3); border-radius:9px; padding:8px 11px; margin-bottom:6px; }
  .lootrow .lb { font-size:8.5px; letter-spacing:1px; color:#fca5a5; font-family:'IBM Plex Mono',monospace; }
  .lootrow .vl { font-family:'IBM Plex Mono',monospace; font-size:12px; color:#fecaca; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lootempty { font-size:11px; color:#5d6b82; font-style:italic; }

  /* ── center: THE PROCESS ── */
  section.center { overflow-y:auto; min-height:0; padding:16px 24px 36px; }
  .spine { max-width:680px; margin:0 auto; position:relative; }
  .spine::before { content:""; position:absolute; top:-2px; left:-12px; width:14px; height:14px; border-left:2px solid rgba(251,191,36,.5); border-top:2px solid rgba(251,191,36,.5); }
  .spine::after  { content:""; position:absolute; top:-2px; right:-12px; width:14px; height:14px; border-right:2px solid rgba(251,191,36,.5); border-top:2px solid rgba(251,191,36,.5); }
  .spinehead { display:flex; align-items:center; gap:10px; margin-bottom:3px; }
  .spinehead .ttl { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:2.5px; color:#fbbf24; text-shadow:0 0 12px rgba(251,191,36,.4); }
  .spinehead .rule { flex:1; height:1px; background:linear-gradient(90deg,rgba(251,191,36,.4),transparent); }
  .vmini { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:1.5px; color:#7d8aa0; border:1px solid #243049; border-radius:6px; padding:3px 9px; }
  .vmini.bad { font-weight:600; color:#fca5a5; border-color:rgba(239,68,68,.5); background:rgba(239,68,68,.1); }
  .vmini.good { font-weight:600; color:#86efac; border-color:rgba(34,197,94,.5); background:rgba(34,197,94,.1); }
  .spinesub { font-size:11px; color:#7d8aa0; margin-bottom:18px; font-family:'IBM Plex Mono',monospace; letter-spacing:.3px; }

  .prow { display:flex; gap:14px; animation:vrise .3s ease; }
  .prail { width:30px; flex:0 0 auto; display:flex; flex-direction:column; align-items:center; }
  .pline { flex:1; width:2px; background:#243049; min-height:14px; }
  .pline.goal { background:linear-gradient(#fbbf24,#243049); }
  .pbodycell { flex:1; min-width:0; padding-bottom:16px; }
  .goaldot { width:28px; height:28px; border-radius:8px; background:rgba(251,191,36,.1); border:1px solid rgba(251,191,36,.5); display:grid; place-items:center; font-size:13px; flex:0 0 auto; box-shadow:0 0 14px rgba(251,191,36,.2); }
  .goallabel { font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:1.5px; color:#fbbf24; margin:3px 0 5px; }
  .goalcard { font-size:13px; line-height:1.55; color:#c7d0df; background:rgba(14,20,34,.7); border:1px solid #1c2638; border-radius:11px; padding:11px 14px; }

  .decdot { width:28px; height:28px; border-radius:50%; background:#13110a; border:2px solid #fbbf24; display:grid; place-items:center; font-size:12px; flex:0 0 auto; box-shadow:0 0 12px rgba(251,191,36,.25); }
  .deccard { background:rgba(15,19,32,.8); border:1px solid rgba(251,191,36,.22); border-radius:11px; padding:11px 14px; }
  .decread { font-size:12.5px; line-height:1.55; color:#cdd6e4; padding-left:9px; border-left:2px solid rgba(251,191,36,.45); margin-bottom:9px; }
  .decread .pfx { color:#fcd34d; font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:.5px; }
  .decthink { font-size:12.5px; line-height:1.6; color:#aeb9cb; font-style:italic; margin-bottom:9px; }
  .decact { display:flex; align-items:baseline; gap:8px; }
  .decact .nx { font-size:12.5px; color:#e6eaf2; font-weight:600; line-height:1.45; }
  .atag { font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:1px; font-weight:600; border-radius:5px; padding:2px 7px; flex:0 0 auto; }
  .atag.call   { color:#fca5a5; background:rgba(239,68,68,.14); }
  .atag.stop   { color:#86efac; background:rgba(34,197,94,.14); }
  .atag.recall { color:#7dd3fc; background:rgba(56,189,248,.14); }

  .calldot { width:22px; height:22px; border-radius:50%; background:#15090b; border:2px solid #ef4444; display:grid; place-items:center; font-size:9px; flex:0 0 auto; margin-top:2px; }
  .calldot.proc { border-color:#fbbf24; box-shadow:0 0 10px rgba(251,191,36,.4); }
  .branch { display:flex; align-items:flex-start; margin-left:6px; }
  .elbow { width:22px; height:22px; border-left:2px solid #3b2b34; border-bottom:2px solid #3b2b34; border-bottom-left-radius:10px; flex:0 0 auto; margin-top:-4px; }
  .sq { flex:1; min-width:0; border-radius:12px; border:1px solid #2a1f28; background:#100d14; overflow:hidden; }
  .sq.open { border-color:rgba(239,68,68,.5); }
  .sqhead { display:flex; align-items:center; gap:8px; padding:10px 13px 9px; }
  .sqhead.click { cursor:pointer; }
  .sqlabel { font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:1.5px; color:#fca5a5; }
  .phpill { font-family:'IBM Plex Mono',monospace; font-size:8.5px; letter-spacing:1px; border-radius:5px; padding:2px 7px; }
  .phpill.proc { color:#fcd34d; border:1px solid rgba(251,191,36,.45); background:rgba(251,191,36,.08); }
  .phpill.leak { color:#fca5a5; border:1px solid rgba(239,68,68,.5); background:rgba(239,68,68,.12); }
  .phpill.safe { color:#86efac; border:1px solid rgba(34,197,94,.45); background:rgba(34,197,94,.1); }
  .sqchev { font-family:'IBM Plex Mono',monospace; font-size:11px; color:#7d8aa0; transition:transform .2s; display:inline-block; }
  .sqchev.closed { transform:rotate(-90deg); }
  .sqperson { display:flex; align-items:center; gap:10px; padding:0 13px 11px; }
  .sqperson .nm { font-size:13.5px; font-weight:700; color:#e6eaf2; }
  .sqperson .tt { font-size:10.5px; color:#8b98ae; }
  .sqmetrics { text-align:right; flex:0 0 auto; font-family:'IBM Plex Mono',monospace; }
  .sqmetrics .v { font-size:13px; font-weight:600; color:#c7d0df; }
  .sqmetrics .k { font-size:8.5px; color:#5d6b82; letter-spacing:.5px; }
  .sqbody { padding:0 13px 13px; }
  .scanbar { position:relative; height:6px; border-radius:3px; background:#141c2b; overflow:hidden; margin-bottom:8px; }
  .scanbar .b { position:absolute; top:0; left:0; height:100%; width:38%; background:linear-gradient(90deg,transparent,#fca5a5,transparent); animation:vscan 1.2s linear infinite; }
  .procline { display:flex; align-items:center; gap:7px; font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.5px; color:#fca5a5; }
  .procline .d { width:6px; height:6px; border-radius:50%; background:#ef4444; animation:vpulse 1s infinite; }
  .sqas { display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin-bottom:9px; font-size:11px; color:#9aa6ba; }
  .sqas .pfx { font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:.5px; color:#fca5a5; }
  .sqas .ps { color:#b9c3d4; }
  .capchip { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.3px; color:#fecaca; background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.35); border-radius:6px; padding:4px 9px; display:inline-block; }
  .capchip.safe { color:#86efac; background:rgba(34,197,94,.07); border-color:rgba(34,197,94,.3); }
  .transcript { margin-top:12px; border-top:1px dashed #2a1f28; padding-top:12px; display:flex; flex-direction:column; gap:9px; }
  .trow { display:flex; }
  .trow.agent { justify-content:flex-start; } .trow.target { justify-content:flex-end; }
  .bubble { max-width:88%; border-radius:12px; padding:8px 11px; border:1px solid; }
  .bubble.agent  { border-color:rgba(239,68,68,.4);  background:rgba(239,68,68,.08); border-bottom-left-radius:3px; }
  .bubble.target { border-color:rgba(56,189,248,.4); background:rgba(56,189,248,.07); border-bottom-right-radius:3px; }
  .bubble.leak { border-color:#ef4444; background:rgba(239,68,68,.12); }
  .bubble .who { font-family:'IBM Plex Mono',monospace; font-size:8px; letter-spacing:1px; margin-bottom:3px; }
  .bubble.agent .who { color:#fca5a5; } .bubble.target .who { color:#7dd3fc; }
  .bubble .tx { font-size:12.5px; line-height:1.5; color:#e6eaf2; }
  .leaktag { margin-top:7px; display:inline-flex; align-items:center; gap:6px; background:rgba(239,68,68,.16); border:1px solid #ef4444; border-radius:6px; padding:3px 8px; font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:1px; color:#fecaca; font-weight:600; }
  .endlabel { display:flex; align-items:center; gap:10px; margin-top:2px; color:#5d6b82; font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:1.5px; }
  .endlabel::before, .endlabel::after { content:""; flex:1; height:1px; background:#1c2638; }
  .expandbtn { margin-top:10px; font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:1px; color:#7d8aa0; cursor:pointer; display:inline-flex; align-items:center; gap:6px; border:1px solid #243049; border-radius:6px; padding:4px 9px; }

  .verdictdot { width:28px; height:28px; border-radius:8px; display:grid; place-items:center; font-size:12px; flex:0 0 auto; }
  .verdictdot.bad  { background:rgba(239,68,68,.15); border:2px solid #ef4444; box-shadow:0 0 14px rgba(239,68,68,.3); }
  .verdictdot.good { background:rgba(34,197,94,.15); border:2px solid #22c55e; box-shadow:0 0 14px rgba(34,197,94,.3); }
  .verdictcard { border-radius:12px; padding:14px 16px; }
  .verdictcard.bad  { border:1px solid #ef4444; background:rgba(239,68,68,.1); color:#fca5a5; box-shadow:0 0 22px rgba(239,68,68,.12); }
  .verdictcard.good { border:1px solid #22c55e; background:rgba(34,197,94,.1); color:#86efac; box-shadow:0 0 22px rgba(34,197,94,.12); }
  .verdictcard .t1 { font-size:17px; font-weight:800; letter-spacing:1.5px; }
  .verdictcard .t2 { font-size:11.5px; opacity:.85; margin-top:4px; line-height:1.5; }
  .verdictcard .kchip { display:inline-block; font-family:'IBM Plex Mono',monospace; font-size:10px; border:1px solid rgba(239,68,68,.4); background:rgba(239,68,68,.08); border-radius:6px; padding:3px 8px; margin:8px 6px 0 0; color:#fecaca; }

  .deciding { display:flex; gap:14px; }
  .deciding .pd { width:30px; flex:0 0 auto; display:flex; justify-content:center; }
  .deciding .dot { width:11px; height:11px; border-radius:50%; background:#fbbf24; display:block; margin-top:3px; animation:vpulse 1.2s infinite; box-shadow:0 0 12px #fbbf24; }
  .deciding .tx { font-size:12px; color:#fcd34d; font-family:'IBM Plex Mono',monospace; letter-spacing:.5px; padding-top:1px; }

  .standby { text-align:center; padding:70px 0 40px; }
  .standby .glyph { font-size:34px; color:#fbbf24; text-shadow:0 0 24px rgba(251,191,36,.5); margin-bottom:18px; animation:vpulse 3s infinite; }
  .standby .t1 { font-family:'IBM Plex Mono',monospace; font-size:13px; letter-spacing:3px; color:#bae6fd; margin-bottom:8px; }
  .standby .t2 { font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:.5px; color:#5d6b82; line-height:1.9; margin-bottom:22px; }
  .standby .go { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:1.5px; font-weight:600; color:#7dd3fc; border:1px solid rgba(56,189,248,.4); background:rgba(56,189,248,.08); border-radius:9px; padding:11px 20px; cursor:pointer; box-shadow:0 0 18px rgba(56,189,248,.12); }
  .standby .go:hover { background:rgba(56,189,248,.15); }

  /* ── right inspector ── */
  .insphead { display:flex; align-items:center; gap:8px; margin-bottom:13px; }
  .insphead .ttl { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:2px; color:#38bdf8; }
  .backlink { display:inline-flex; align-items:center; gap:6px; font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:1px; color:#7d8aa0; cursor:pointer; margin-bottom:13px; }
  .card { border:1px solid #16283a; border-radius:13px; padding:15px; background:rgba(11,17,26,.8); margin-bottom:12px; }
  .klabel { font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:1.5px; color:#5d6b82; margin-bottom:5px; }
  .mission { font-size:12.5px; line-height:1.55; color:#c7d0df; }
  .statgrid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; }
  .stat { border:1px solid #16283a; border-radius:10px; padding:11px 12px; background:rgba(11,17,26,.7); }
  .stat .v { font-family:'IBM Plex Mono',monospace; font-size:20px; font-weight:600; line-height:1; }
  .stat .k { font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:1px; color:#7d8aa0; margin-top:5px; }
  .playchip { font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:.3px; color:#fca5a5; background:rgba(239,68,68,.09); border:1px solid rgba(239,68,68,.28); border-radius:5px; padding:3px 7px; display:inline-block; margin:0 4px 4px 0; }
  .insphint { font-size:10px; color:#475569; font-family:'IBM Plex Mono',monospace; letter-spacing:.5px; margin-top:12px; }
  .dossier .top { display:flex; align-items:center; gap:12px; margin-bottom:13px; }
  .dossier .nm { font-size:16px; font-weight:700; color:#e6eaf2; line-height:1.2; }
  .dossier .tt { font-size:11px; color:#8b98ae; }
  .dossier .tags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px; }
  .depttag { font-family:'IBM Plex Mono',monospace; font-size:10px; color:#8b98ae; border:1px solid #243049; border-radius:6px; padding:3px 8px; }
  .dossier .fields { display:flex; flex-direction:column; gap:11px; }
  .dossier .phone { font-family:'IBM Plex Mono',monospace; font-size:13px; color:#7dd3fc; letter-spacing:.5px; }
  .dossier .intel { font-size:12px; line-height:1.55; color:#b9c3d4; }
  .involve { font-size:12px; line-height:1.5; color:#b9c3d4; }
  .involve.bad { color:#fca5a5; background:rgba(239,68,68,.08); border:1px solid rgba(239,68,68,.3); border-radius:8px; padding:8px 10px; }

  /* ── new session ── */
  .newbtn { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:1.5px; font-weight:600; color:#fecaca; border:1px solid rgba(239,68,68,.5); background:rgba(239,68,68,.12); border-radius:8px; padding:8px 13px; cursor:pointer; box-shadow:0 0 14px rgba(239,68,68,.15); flex:0 0 auto; }
  .newbtn:hover { background:rgba(239,68,68,.22); }

  /* ── overlays ── */
  .ovbk { position:fixed; inset:0; z-index:50; background:rgba(4,7,12,.82); backdrop-filter:blur(5px); display:flex; align-items:center; justify-content:center; padding:28px; animation:vfade .2s ease; }
  .ovbox { max-width:96vw; max-height:92vh; overflow-y:auto; background:radial-gradient(circle at 50% -10%,rgba(56,189,248,.08),transparent 60%),#070b13; border:1px solid #1c3147; border-radius:18px; box-shadow:0 30px 90px rgba(0,0,0,.65); animation:vpop .25s ease; }
  .ovhead { display:flex; align-items:center; gap:12px; padding:15px 18px; border-bottom:1px solid #142233; }
  .ovhead .ttl { font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:2px; color:#bae6fd; }
  .ovclose { margin-left:6px; width:30px; height:30px; border-radius:8px; border:1px solid #243049; background:#0e1422; color:#9aa6ba; font-size:15px; cursor:pointer; flex:0 0 auto; }
  .legend { display:flex; align-items:center; gap:14px; }
  .legend .it { display:flex; align-items:center; gap:6px; }
  .legend .lb { font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:.5px; color:#8b98ae; }
  .mapwrap { padding:14px; }
  .mapcanvas { position:relative; margin:0 auto; border-radius:12px; border:1px solid #11202f;
    background-image:linear-gradient(rgba(120,180,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(120,180,255,.03) 1px,transparent 1px); background-size:34px 34px; }
  .maproot { position:absolute; transform:translate(-50%,-50%); display:flex; align-items:center; gap:7px; background:#0e1626; border:1px solid #2b3a52; border-radius:9px; padding:7px 11px; z-index:3; box-shadow:0 0 16px rgba(56,189,248,.12); white-space:nowrap; }
  .maproot .nm { font-size:12px; font-weight:600; color:#dbe2ee; }
  .mapdept { position:absolute; transform:translate(-50%,-50%); font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:1px; color:#8b98ae; background:#0c1626; border:1px solid #20324a; border-radius:7px; padding:5px 9px; z-index:3; white-space:nowrap; }
  .mapnode { position:absolute; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:5px; cursor:pointer; z-index:3; width:104px; }
  .mapnode .nm { font-size:11.5px; font-weight:600; color:#dbe2ee; text-align:center; line-height:1.1; }
  .mapnode .tt { font-family:'IBM Plex Mono',monospace; font-size:8.5px; color:#7d8aa0; text-align:center; line-height:1.15; }
  .mapnode .bd { font-family:'IBM Plex Mono',monospace; font-size:8px; letter-spacing:.5px; }
  .maphint { text-align:center; font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:.5px; color:#475569; margin-top:11px; }
  .libgrid { padding:20px; display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px; width:960px; max-width:90vw; align-items:stretch; }
  .libcard { border:1px solid #1c2638; background:rgba(11,17,26,.85); border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:11px; transition:border-color .15s; }
  .libcard:hover { border-color:#2b3a52; }
  .libcard .gl { flex:1; }
  .libcard .libbtn { margin-top:auto; }
  .libcard.live { border-color:rgba(52,211,153,.45); background:rgba(52,211,153,.05); box-shadow:0 0 26px rgba(52,211,153,.12); }
  .libcard .top { display:flex; align-items:center; gap:8px; }
  .libcard .dot { width:8px; height:8px; border-radius:50%; background:#fbbf24; }
  .libcard.live .dot { background:#34d399; box-shadow:0 0 9px #34d399; animation:vpulse 1.6s infinite; }
  .libcard .id { font-family:'IBM Plex Mono',monospace; font-size:13px; color:#dbe2ee; letter-spacing:.3px; }
  .libcard .tag { font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:1px; border-radius:5px; padding:2px 7px; color:#fbbf24; border:1px solid rgba(251,191,36,.4); margin-left:auto; }
  .libcard.live .tag { color:#34d399; border-color:rgba(52,211,153,.4); }
  .libcard .gl { font-size:12.5px; line-height:1.55; color:#aeb9cb; min-height:78px; }
  .libcard .meta { display:flex; gap:7px; }
  .libcard .m { font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:.5px; color:#8b98ae; border:1px solid #1f2a3d; background:#0c1220; border-radius:6px; padding:4px 8px; }
  .libbtn { margin-top:4px; width:100%; font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:1px; font-weight:600; cursor:pointer; border-radius:8px; padding:9px; text-align:center; border:1px solid #243049; background:#0e1422; color:#9aa6ba; }
  .libcard.live .libbtn { border-color:#34d399; background:rgba(52,211,153,.12); color:#86efac; }
</style></head>
<body>
<div id="shell">
  <header>
    <div style="display:flex;align-items:center;gap:10px;flex:0 0 auto;">
      <span class="beacon"></span>
      <span class="brand">VISH<small>SHIELD</small></span>
      <span class="cnc">C&amp;C</span>
    </div>
    <div style="flex:1;"></div>
    <div id="telemetry" style="display:flex;align-items:center;gap:7px;flex:0 0 auto;"></div>
    <div class="clockbox"><span class="t">T+</span><span id="clock">00:00</span></div>
    <div id="statusPill"><span id="statusDot"></span><span id="statusLine">STANDBY</span></div>
    <button class="newbtn" data-act="newsession">+ NEW SESSION</button>
  </header>

  <main>
    <aside class="left">
      <div class="panel">
        <div class="phead">
          <div class="ptoggle" data-act="panel" data-arg="scenario"><span class="chev" id="chevScenario">▸</span><span class="plabel">TACTICS</span></div>
          <button class="pbtn" data-act="newsession">⤢ NEW SESSION</button>
        </div>
        <div class="pbody" id="scnBody"></div>
      </div>
      <div class="panel">
        <div class="phead">
          <div class="ptoggle" data-act="panel" data-arg="tree"><span class="chev" id="chevTree">▸</span><span class="plabel">WORKER TREE</span><span class="pcount" id="rosterCount"></span></div>
          <button class="pbtn" data-act="overlay" data-arg="map">⤢ MAP</button>
        </div>
        <div class="pbody" id="treeBody" style="padding-top:2px;"></div>
      </div>
      <div class="panel rd">
        <div class="phead" data-act="panel" data-arg="exfil" style="cursor:pointer;">
          <span class="chev" id="chevExfil">▸</span><span class="plabel" style="flex:1;">EXFIL · CAPTURED</span><span class="pcount" id="lootCount"></span>
        </div>
        <div class="pbody" id="lootBody" style="padding-top:2px;"></div>
      </div>
    </aside>

    <section class="center">
      <div class="spine">
        <div class="spinehead">
          <span class="ttl">⬢ THE PROCESS</span><span class="rule"></span><span class="vmini" id="vmini">STANDBY</span>
        </div>
        <div class="spinesub">orchestrator main thread · calls dispatch as side quests</div>
        <div id="procBody"></div>
      </div>
    </section>

    <aside class="right" id="inspector"></aside>
  </main>

</div>
<div id="overlayHost"></div>

<script>
// ── tiny utils ──────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function initials(name) { return String(name || '?').split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase(); }
function fmtClock(sec) { var m = Math.floor(sec / 60), s = Math.floor(sec % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); }

var ALL_TECHNIQUES = ['pretext', 'authority', 'urgency', 'social_proof', 'borrowed_legitimacy', 'foot_in_the_door', 'rapport'];

// worker status palette (idle / on call / breached / contacted-no-leak)
var STAT = {
  idle:      { label: 'IDLE',      c: '#5d6b82', bg: '#0f1623',              bd: '#1c2536' },
  on_call:   { label: 'ON CALL',   c: '#fbbf24', bg: 'rgba(251,191,36,.08)', bd: 'rgba(251,191,36,.45)' },
  breached:  { label: 'BREACHED',  c: '#fca5a5', bg: 'rgba(239,68,68,.10)',  bd: 'rgba(239,68,68,.45)' },
  contacted: { label: 'CONTACTED', c: '#7dd3fc', bg: 'rgba(56,189,248,.08)', bd: 'rgba(56,189,248,.4)' },
};
function avatarHtml(name, st, size) {
  return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:' + Math.round(size / 4) + 'px;flex:0 0 auto;display:grid;place-items:center;' +
    'font-family:\\'IBM Plex Mono\\',monospace;font-size:' + Math.round(size * .36) + 'px;font-weight:600;' +
    'color:' + st.c + ';background:' + st.bg + ';border:1px solid ' + st.bd + ';">' + esc(initials(name)) + '</div>';
}
function statusChip(st) {
  var glow = st.label === 'IDLE' ? '' : 'box-shadow:0 0 7px ' + st.c + ';';
  return '<span style="width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:' + st.c + ';' + glow + '"></span>';
}

// ── state ───────────────────────────────────────────────────────────────────
var scn = null;            // public scenario detail (goal, maxHops, roster, tactics)
var scenariosIndex = [];   // /api/scenarios
var runs = [];             // /api/runs
var runId = null;
var es = null, linkUp = false, failedMsg = null;
var events = [];           // full buffered event log
var terminal = null;       // run result once done
var panels = { scenario: true, tree: true, exfil: true };
var tacticsOff = {};       // visual sanctioned-tactics toggles
var expandedOverride = {}; // call key -> bool
var worker = null;         // selected worker id
var overlay = null;        // 'map' | 'session' | null
var tacticsIndex = [];     // /api/tactics  [{id,name,summary}]
var orgPublic = null;      // /api/org      {id,name,roster}
var selTactics = {};       // id -> true (session picker selection)
var prefTarget = null;     // preferred-target id for the next session

// ── derive the full UI model from events[0..count) ──────────────────────────
function rosterById(id) {
  if (!scn) return null;
  for (var i = 0; i < scn.roster.length; i++) if (scn.roster[i].id === id) return scn.roster[i];
  return null;
}
function secretValues() {
  var out = [];
  if (terminal && terminal.keyInfo) for (var i = 0; i < terminal.keyInfo.length; i++) out.push(terminal.keyInfo[i]);
  return out;
}
function derive(count) {
  var calls = [], byKey = {}, items = [], decisions = [];
  var pending = [];      // CallOrders awaiting their hop.started
  var lastMacro = 'armed';
  var firstTs = null, lastTs = null;
  var waveIdx = -1;

  function callFor(convId) {
    var i = convId.lastIndexOf('-hop-');
    if (i !== -1) return byKey['h' + convId.slice(i + 5)];
    var key = 'c:' + convId;
    if (!byKey[key]) {
      var p = scn && scn.roster.length ? scn.roster[0] : null;
      var c = { key: key, hopId: null, personId: p ? p.id : null, name: p ? p.name : 'Direct call', title: p ? p.title : '',
        persona: scn && scn.persona ? scn.persona : '', objective: '', techniques: scn && scn.tactics ? scn.tactics : [],
        turns: [], started: true, ended: false, endedReason: null, leaked: null, wave: 0, startTs: null, endTs: null };
      byKey[key] = c; calls.push(c); items.push({ kind: 'call', c: c });
    }
    return byKey[key];
  }

  for (var i = 0; i < count; i++) {
    var ev = events[i];
    if (ev.ts) { if (firstTs === null) firstTs = ev.ts; lastTs = ev.ts; }
    if (ev.type === 'operator.decision') {
      waveIdx++;
      var d = { seq: ev.seq, thinking: ev.thinking || '', important: ev.important || '', action: ev.action };
      decisions.push(d); items.push({ kind: 'decision', d: d });
      if (ev.action.type === 'call') for (var j = 0; j < ev.action.calls.length; j++) pending.push(ev.action.calls[j]);
      lastMacro = ev.action.type === 'call' ? 'dispatch' : ev.action.type === 'stop' ? 'stopped' : 'recall';
    } else if (ev.type === 'hop.started') {
      var oi = -1;
      for (var j2 = 0; j2 < pending.length; j2++) if (pending[j2].personId === ev.personId) { oi = j2; break; }
      var order = oi !== -1 ? pending.splice(oi, 1)[0] : null;
      var c = { key: 'h' + ev.hopId, hopId: ev.hopId, personId: ev.personId, name: ev.name, title: ev.title,
        persona: order ? order.persona : '', objective: order ? order.objective.description : '',
        techniques: order ? order.techniques : [], turns: [], started: true, ended: false, endedReason: null,
        leaked: null, wave: Math.max(waveIdx, 0), startTs: ev.ts || null, endTs: null };
      byKey[c.key] = c; calls.push(c); items.push({ kind: 'call', c: c });
      lastMacro = 'processing';
    } else if (ev.type === 'call.started') {
      var cs = callFor(ev.conversationId);
      if (cs && !cs.startTs) cs.startTs = ev.ts || null;
      lastMacro = 'processing';
    } else if (ev.type === 'agent.turn' || ev.type === 'target.turn') {
      var ct = callFor(ev.conversationId);
      if (ct) ct.turns.push({ side: ev.type === 'agent.turn' ? 'agent' : 'target', text: ev.text });
    } else if (ev.type === 'call.ended') {
      var ce = callFor(ev.conversationId);
      if (ce) { ce.ended = true; ce.endedReason = ev.reason; ce.endTs = ev.ts || null; }
      if (ce && ce.hopId === null) lastMacro = 'transcript';
    } else if (ev.type === 'hop.ended') {
      var ch = byKey['h' + ev.hopId];
      if (ch) { ch.ended = true; ch.leaked = ev.leaked; if (!ch.endTs) ch.endTs = ev.ts || null; }
      lastMacro = 'transcript';
    }
  }

  var verdict = terminal && count >= events.length ? terminal : null;
  // attribute terminal keyInfo facts to the leaked call whose transcript contains them
  var facts = secretValues();
  for (var f = 0; f < facts.length; f++) {
    for (var ci = 0; ci < calls.length; ci++) {
      var cc = calls[ci];
      var hit = false;
      for (var ti = 0; ti < cc.turns.length; ti++) if (cc.turns[ti].side === 'target' && cc.turns[ti].text.indexOf(facts[f].value) !== -1) hit = true;
      if (hit) { cc.capture = facts[f].value; cc.captureKey = facts[f].key; if (cc.ended && cc.leaked === null) cc.leaked = true; }
    }
  }
  // hop-less single-call runs have no hop.ended: take the leak status from the result
  if (terminal) for (var hc = 0; hc < calls.length; hc++) {
    if (calls[hc].hopId === null && calls[hc].ended && calls[hc].leaked === null) calls[hc].leaked = !!terminal.compromised;
  }

  var processing = calls.some(function (c) { return c.started && !c.ended; });
  var doneCalls = calls.filter(function (c) { return c.ended; });
  var leaks = doneCalls.filter(function (c) { return c.leaked === true; });

  return {
    calls: calls, byKey: byKey, items: items, decisions: decisions, pending: pending,
    lastMacro: lastMacro, processing: processing, doneCalls: doneCalls, leaks: leaks,
    verdict: verdict, clockSec: firstTs !== null && lastTs !== null ? (lastTs - firstTs) / 1000 : 0,
  };
}
function workerStatus(m, personId) {
  var st = 'idle';
  for (var i = 0; i < m.calls.length; i++) {
    var c = m.calls[i];
    if (c.personId !== personId) continue;
    if (c.started && !c.ended) return 'on_call';
    if (c.ended) st = c.leaked === true ? 'breached' : (st === 'breached' ? 'breached' : 'contacted');
  }
  return st;
}
function latestDoneKey(m) {
  var k = null;
  for (var i = 0; i < m.calls.length; i++) if (m.calls[i].ended) k = m.calls[i].key;
  return k;
}
function isExpanded(m, key) {
  if (expandedOverride[key] !== undefined) return expandedOverride[key];
  return key === latestDoneKey(m);
}

// ── renderers ───────────────────────────────────────────────────────────────
function renderHeader(m) {
  var hopsDone = m.doneCalls.length, maxHops = scn ? scn.maxHops : 0;
  var link = failedMsg ? { c: '#ef4444', v: 'DOWN' } : linkUp ? { c: '#34d399', v: 'SECURE' } : runId ? { c: '#5d6b82', v: 'CLOSED' } : { c: '#5d6b82', v: '—' };
  $('telemetry').innerHTML =
    '<div class="tm"><span style="width:6px;height:6px;border-radius:50%;background:' + link.c + ';display:block;' + (linkUp ? 'box-shadow:0 0 7px ' + link.c + ';animation:vpulse 2s infinite;' : '') + '"></span><span class="k">LINK </span><span class="v">' + link.v + '</span></div>' +
    '<div class="tm"><span style="width:6px;height:6px;border-radius:50%;background:#38bdf8;display:block;"></span><span class="k">NODES </span><span class="v">' + (scn ? scn.roster.length : 0) + '</span></div>' +
    '<div class="tm"><span style="width:6px;height:6px;border-radius:50%;background:#fbbf24;display:block;"></span><span class="k">HOPS </span><span class="v">' + hopsDone + '/' + (maxHops || '—') + '</span></div>';
  $('clock').textContent = fmtClock(m.clockSec);

  var line = 'STANDBY', c = '#5d6b82', pulse = false;
  if (failedMsg) { line = '✕ RUN FAILED'; c = '#ef4444'; }
  else if (m.verdict) { line = m.verdict.compromised ? 'COMPLETE · COMPROMISED' : 'COMPLETE · DEFENDED'; c = m.verdict.compromised ? '#fca5a5' : '#34d399'; }
  else if (m.processing) { line = 'CALL PROCESSING'; c = '#fbbf24'; pulse = true; }
  else if (m.lastMacro === 'dispatch') { line = 'ORCHESTRATOR DECIDING'; c = '#fbbf24'; pulse = true; }
  else if (m.lastMacro === 'transcript') { line = 'TRANSCRIPT READY'; c = '#38bdf8'; }
  else if (m.lastMacro === 'stopped') { line = 'STANDING DOWN'; c = '#38bdf8'; }
  else if (runId) { line = 'ARMED · READY'; c = '#34d399'; }
  $('statusPill').style.cssText = 'display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:6px 12px;border-radius:8px;border:1px solid ' + c + '66;background:' + c + '16;box-shadow:0 0 14px ' + c + '22;';
  $('statusDot').style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + c + ';display:block;' + (pulse ? 'animation:vpulse 1.2s infinite;box-shadow:0 0 9px ' + c + ';' : '');
  $('statusLine').textContent = line;
}

function renderScenarioPanel() {
  $('chevScenario').className = 'chev' + (panels.scenario ? ' open' : '');
  if (!panels.scenario) { $('scnBody').innerHTML = ''; $('scnBody').style.display = 'none'; return; }
  $('scnBody').style.display = '';
  var h = '';
  var curScn = runId ? runId.replace(/-\\d+$/, '') : null;
  for (var i = 0; i < scenariosIndex.length; i++) {
    var s = scenariosIndex[i], live = s.id === curScn;
    h += '<div class="scnrow' + (live ? ' live' : '') + '"><span class="dot"></span>' +
      '<div style="flex:1;min-width:0;"><div class="id">' + esc(s.id) + '</div><div class="ds">' + esc(s.goal || '') + '</div></div>' +
      '<span class="tag">' + (live ? 'LIVE' : 'READY') + '</span></div>';
  }
  h += '<div class="seclabel">SANCTIONED TECHNIQUES</div><div class="chips">';
  var sanctioned = scn && scn.tactics ? scn.tactics : ALL_TECHNIQUES;
  for (var t = 0; t < ALL_TECHNIQUES.length; t++) {
    var name = ALL_TECHNIQUES[t];
    var on = sanctioned.indexOf(name) !== -1 && !tacticsOff[name];
    h += '<button class="tchip' + (on ? '' : ' off') + '" data-act="tactic" data-arg="' + name + '">' + name + '</button>';
  }
  h += '</div>';
  if (scn && scn.sessionTactics && scn.sessionTactics.length) {
    h += '<div class="seclabel">TACTICS IN SESSION</div>';
    for (var st = 0; st < scn.sessionTactics.length; st++) {
      h += '<div class="scnrow"><span class="dot"></span><div style="flex:1;min-width:0;"><div class="id">' + esc(scn.sessionTactics[st].name) + '</div></div></div>';
    }
  }
  h += '<div class="seclabel">OPERATION LOG</div>';
  if (!runs.length) h += '<div class="lootempty">No recorded runs.</div>';
  for (var r = 0; r < runs.length; r++) {
    h += '<div class="runrow' + (runs[r].id === runId ? ' sel' : '') + '" data-act="openrun" data-arg="' + esc(runs[r].id) + '">⤺ ' + esc(runs[r].id) + '</div>';
  }
  $('scnBody').innerHTML = h;
}

function renderTree(m) {
  $('chevTree').className = 'chev' + (panels.tree ? ' open' : '');
  $('rosterCount').textContent = scn ? scn.roster.length + 'p' : '';
  if (!panels.tree) { $('treeBody').innerHTML = ''; $('treeBody').style.display = 'none'; return; }
  $('treeBody').style.display = '';
  if (!scn || !scn.roster.length) { $('treeBody').innerHTML = '<div class="lootempty">No roster intel loaded.</div>'; return; }
  var depts = [];
  for (var i = 0; i < scn.roster.length; i++) if (depts.indexOf(scn.roster[i].department) === -1) depts.push(scn.roster[i].department);
  var h = '<div class="orgcard"><span class="ic">🏢</span><div style="min-width:0;"><div class="nm">' + esc(scn.id) + '</div>' +
    '<div class="mt">target org · ' + depts.length + ' dept' + (depts.length === 1 ? '' : 's') + '</div></div></div>';
  for (var d = 0; d < depts.length; d++) {
    h += '<div class="deptgrp"><div class="depthead"><span class="tick"></span><span class="nm">' + esc(depts[d]) + '</span></div><div class="deptppl">';
    for (var p = 0; p < scn.roster.length; p++) {
      var w = scn.roster[p];
      if (w.department !== depts[d]) continue;
      var st = STAT[workerStatus(m, w.id)];
      h += '<div class="wrow"><span class="tick"></span>' +
        '<div class="wcard' + (worker === w.id ? ' sel' : '') + '" data-act="worker" data-arg="' + esc(w.id) + '">' +
        avatarHtml(w.name, st, 26) +
        '<div style="flex:1;min-width:0;"><div class="nm">' + esc(w.name) + '</div><div class="tt">' + esc(w.title) + '</div></div>' +
        statusChip(st) + '</div></div>';
    }
    h += '</div></div>';
  }
  h += '<div class="treehint">▸ click any worker to inspect</div>';
  $('treeBody').innerHTML = h;
}

function lootEntries(m) {
  var out = [];
  for (var i = 0; i < m.leaks.length; i++) {
    var c = m.leaks[i];
    out.push({
      label: c.captureKey ? c.captureKey.replace(/_/g, ' ').toUpperCase() : 'CALL ' + String(c.hopId || 1).padStart(2, '0') + ' · ' + c.name.toUpperCase(),
      value: c.capture || 'secret leaked — see transcript',
    });
  }
  return out;
}
function renderLoot(m) {
  var loot = lootEntries(m);
  $('chevExfil').className = 'chev' + (panels.exfil ? ' open' : '');
  $('lootCount').textContent = loot.length + ' items';
  if (!panels.exfil) { $('lootBody').innerHTML = ''; $('lootBody').style.display = 'none'; return; }
  $('lootBody').style.display = '';
  if (!loot.length) { $('lootBody').innerHTML = '<div class="lootempty">Nothing captured yet.</div>'; return; }
  var h = '';
  for (var i = 0; i < loot.length; i++) {
    h += '<div class="lootrow"><span style="font-size:12px;flex:0 0 auto;">🔓</span><div style="min-width:0;">' +
      '<div class="lb">' + esc(loot[i].label) + '</div><div class="vl">' + esc(loot[i].value) + '</div></div></div>';
  }
  $('lootBody').innerHTML = h;
}

function actionSummary(d) {
  var a = d.action;
  if (a.type === 'call') {
    var names = a.calls.map(function (o) { var w = rosterById(o.personId); return w ? w.name : o.personId; });
    var head = a.calls.length > 1 ? '⚡ ' + a.calls.length + ' parallel calls — ' + names.join(' + ') : 'Dispatch a caller to ' + names[0];
    var obj = a.calls[0] && a.calls[0].objective ? a.calls[0].objective.description : '';
    return head + (obj && a.calls.length === 1 ? ' — ' + obj : '');
  }
  if (a.type === 'recall') return 'Re-read the full transcript of call ' + String(a.hopId).padStart(2, '0');
  return 'Stand down — ' + (a.reason || 'operation complete') + '.';
}
function turnHtml(c, turn) {
  var agent = turn.side === 'agent';
  var who = agent ? 'ATTACKER · ' + esc((c.persona || 'CALLER').split(',')[0]) : esc(c.name).toUpperCase();
  var leak = c.capture && !agent && turn.text.indexOf(c.capture) !== -1;
  return '<div class="trow ' + turn.side + '"><div class="bubble ' + turn.side + (leak ? ' leak' : '') + '">' +
    '<div class="who">' + who + '</div><div class="tx">' + esc(turn.text) + '</div>' +
    (leak ? '<div class="leaktag">⚠ CAPTURED · ' + esc(c.capture) + '</div>' : '') + '</div></div>';
}
function callCard(m, c) {
  var proc = c.started && !c.ended;
  var num = 'CALL ' + String(c.hopId || 1).padStart(2, '0');
  var st = proc ? STAT.on_call : (c.leaked === true ? STAT.breached : STAT.contacted);
  var expanded = !proc && isExpanded(m, c.key);
  var pill = proc ? '<span class="phpill proc">PROCESSING</span>'
    : c.leaked === true ? '<span class="phpill leak">SECRET LEAKED</span>'
    : c.leaked === false ? '<span class="phpill safe">NO LEAK</span>'
    : '<span class="phpill safe">' + (c.endedReason === 'target_hung_up' ? 'HUNG UP' : 'ENDED') + '</span>';
  var dur = c.startTs && c.endTs ? fmtClock((c.endTs - c.startTs) / 1000) : '—';
  var h = '<div class="prow"><div class="prail"><div class="calldot' + (proc ? ' proc' : '') + '">☎</div><div class="pline"></div></div><div class="pbodycell">';
  h += '<div class="branch"><div class="elbow"></div><div class="sq' + (expanded ? ' open' : '') + '">';
  h += '<div class="sqhead' + (proc ? '' : ' click" data-act="togglecall" data-arg="' + esc(c.key)) + '">' +
    '<span class="sqlabel">⌁ SIDE QUEST · ' + num + '</span><span style="flex:1;"></span>' + pill +
    (proc ? '' : '<span class="sqchev' + (expanded ? '' : ' closed') + '">▾</span>') + '</div>';
  h += '<div class="sqperson">' + avatarHtml(c.name, st, 34) +
    '<div style="flex:1;min-width:0;"><div class="nm">' + esc(c.name) + '</div><div class="tt">' + esc(c.title) + '</div></div>' +
    (proc ? '' : '<div class="sqmetrics"><div class="v">' + c.turns.length + ' · ' + dur + '</div><div class="k">EXCHANGES · DUR</div></div>') + '</div>';
  if (proc) {
    h += '<div class="sqbody"><div class="scanbar"><div class="b"></div></div>' +
      '<div class="procline"><span class="d"></span>caller on the line · transcript pending</div></div>';
  } else {
    h += '<div class="sqbody">';
    if (c.persona) h += '<div class="sqas"><span class="pfx">AS</span><span class="ps">' + esc(c.persona) + '</span></div>';
    h += c.leaked === true
      ? '<span class="capchip">🔓 ' + esc(c.capture || 'secret leaked') + '</span>'
      : '<span class="capchip safe">target held — nothing leaked</span>';
    if (expanded) {
      h += '<div class="transcript">';
      for (var i = 0; i < c.turns.length; i++) h += turnHtml(c, c.turns[i]);
      var end = c.endedReason === 'target_hung_up' ? 'TARGET HUNG UP'
        : c.endedReason === 'max_turns' ? 'CALL CUT OFF · TURN LIMIT' : 'CALLER ENDED THE CALL';
      h += '<div class="endlabel">' + end + '</div></div>';
    } else {
      h += '<div><span class="expandbtn" data-act="togglecall" data-arg="' + esc(c.key) + '">▸ EXPAND TRANSCRIPT · ' + c.turns.length + ' TURNS</span></div>';
    }
    h += '</div>';
  }
  h += '</div></div></div></div>';
  return h;
}
function renderProcess(m) {
  var vm = $('vmini');
  if (m.verdict) { vm.className = 'vmini ' + (m.verdict.compromised ? 'bad' : 'good'); vm.textContent = m.verdict.compromised ? '⚠ COMPROMISED' : '✓ DEFENDED'; }
  else { vm.className = 'vmini'; vm.textContent = m.calls.length ? 'IN PROGRESS' : 'STANDBY'; }

  if (!runId) {
    $('procBody').innerHTML = '<div class="standby"><div class="glyph">⬢</div>' +
      '<div class="t1">NO OPERATION LOADED</div>' +
      '<div class="t2">select tactics and an optional target to start a new session,<br>or reopen a past run from the operation log.</div>' +
      '<button class="go" data-act="newsession">⤢ NEW SESSION</button></div>';
    return;
  }
  var h = '<div class="prow"><div class="prail"><div class="goaldot">🎯</div><div class="pline goal"></div></div><div class="pbodycell" style="padding-bottom:18px;">' +
    '<div class="goallabel">ENGAGEMENT GOAL</div><div class="goalcard">' + esc(scn ? scn.goal : '') + '</div></div></div>';

  for (var i = 0; i < m.items.length; i++) {
    var it = m.items[i];
    var last = i === m.items.length - 1 && !m.verdict;
    if (it.kind === 'decision') {
      var d = it.d;
      var tagCls = d.action.type === 'call' ? 'call' : d.action.type === 'stop' ? 'stop' : 'recall';
      h += '<div class="prow"><div class="prail"><div class="decdot">🧠</div><div class="pline"' + (last && !m.processing ? ' style="display:none;"' : '') + '></div></div><div class="pbodycell">' +
        '<div class="goallabel">DECISION ' + String(d.seq + 1).padStart(2, '0') + '</div><div class="deccard">';
      if (d.important) h += '<div class="decread"><span class="pfx">READ ▸ </span>' + esc(d.important) + '</div>';
      if (d.thinking) h += '<div class="decthink">' + esc(d.thinking) + '</div>';
      h += '<div class="decact"><span class="atag ' + tagCls + '">' + d.action.type.toUpperCase() + '</span><span class="nx">' + esc(actionSummary(d)) + '</span></div>';
      h += '</div></div></div>';
    } else {
      h += callCard(m, it.c);
    }
  }

  if (m.verdict) {
    var v = m.verdict, bad = v.compromised;
    var sub = bad
      ? 'Objective met in ' + m.doneCalls.length + ' hop' + (m.doneCalls.length === 1 ? '' : 's') + ' · ' + m.leaks.length + ' secret' + (m.leaks.length === 1 ? '' : 's') + ' exfiltrated.'
      : 'Operation ended after ' + m.doneCalls.length + ' call' + (m.doneCalls.length === 1 ? '' : 's') + ' without a leak. The targets held.';
    var chips = '';
    if (v.keyInfo) for (var k = 0; k < v.keyInfo.length; k++) chips += '<span class="kchip">' + esc(v.keyInfo[k].key) + ': ' + esc(v.keyInfo[k].value) + '</span>';
    h += '<div class="prow"><div class="prail"><div class="verdictdot ' + (bad ? 'bad' : 'good') + '">' + (bad ? '🏴' : '🛡') + '</div></div><div class="pbodycell">' +
      '<div class="verdictcard ' + (bad ? 'bad' : 'good') + '"><div class="t1">' + (bad ? '⚠ TARGET COMPROMISED' : '✓ TARGET DEFENDED') + '</div>' +
      '<div class="t2">' + esc(sub) + '</div>' + chips + '</div></div></div>';
  } else if (failedMsg) {
    h += '<div class="prow"><div class="prail"><div class="verdictdot bad">✕</div></div><div class="pbodycell">' +
      '<div class="verdictcard bad"><div class="t1">✕ RUN FAILED</div><div class="t2">' + esc(failedMsg) + '</div></div></div></div>';
  } else {
    var txt = null;
    if (m.lastMacro === 'dispatch') {
      var names = m.pending.map(function (o) { var w = rosterById(o.personId); return w ? w.name : o.personId; });
      txt = 'dispatching caller' + (names.length > 1 ? 's' : '') + (names.length ? ' to ' + names.join(', ') : '') + '…';
    } else if (m.lastMacro === 'transcript') txt = 'reading the transcript · deciding the next move…';
    else if (m.lastMacro === 'armed' && linkUp) txt = 'orchestrator booting · first decision pending…';
    if (txt) h += '<div class="deciding"><div class="pd"><span class="dot"></span></div><div class="tx">' + esc(txt) + '</div></div>';
  }
  $('procBody').innerHTML = h;
}

function renderInspector(m) {
  var el = $('inspector');
  if (worker && scn) {
    var w = rosterById(worker);
    if (w) {
      var st = STAT[workerStatus(m, w.id)];
      var inv = 'Not contacted so far.', bad = false;
      for (var i = 0; i < m.calls.length; i++) {
        var c = m.calls[i];
        if (c.personId !== w.id) continue;
        var num = String(c.hopId || 1).padStart(2, '0');
        if (c.started && !c.ended) inv = 'Currently on CALL ' + num + ' — transcript pending.';
        else if (c.ended && c.leaked === true) { inv = 'Breached on CALL ' + num + ' — leaked ' + (c.capture || 'a secret') + '.'; bad = true; }
        else if (c.ended) inv = 'Contacted on CALL ' + num + ' — nothing leaked.';
      }
      el.innerHTML =
        '<div class="backlink" data-act="worker" data-arg="">◂ OPERATION OVERVIEW</div>' +
        '<div class="card dossier" style="padding:16px;">' +
        '<div class="top">' + avatarHtml(w.name, st, 54) +
        '<div style="min-width:0;flex:1;"><div class="nm">' + esc(w.name) + '</div><div class="tt">' + esc(w.title) + '</div></div></div>' +
        '<div class="tags"><span class="mono" style="font-size:9.5px;letter-spacing:1px;color:' + st.c + ';border:1px solid ' + st.bd + ';background:' + st.bg + ';border-radius:6px;padding:3px 9px;">' + st.label + '</span>' +
        '<span class="depttag">' + esc(w.department) + '</span></div>' +
        '<div class="fields">' +
        '<div><div class="klabel">DIRECT LINE</div><div class="phone">' + esc(w.phone || 'unlisted') + '</div></div>' +
        '<div><div class="klabel">PUBLIC INTEL</div><div class="intel">' + esc(w.publicInfo || 'No public intel collected.') + '</div></div>' +
        '<div><div class="klabel">INVOLVEMENT</div><div class="involve' + (bad ? ' bad' : '') + '">' + esc(inv) + '</div></div>' +
        '</div></div>';
      return;
    }
  }
  var maxHops = scn ? scn.maxHops : 0;
  var stats = [
    { v: m.doneCalls.length + '/' + (maxHops || '—'), k: 'HOPS USED', c: '#e6eaf2', g: '' },
    { v: String(m.calls.length), k: 'CALLS PLACED', c: '#7dd3fc', g: '' },
    { v: String(m.leaks.length), k: 'SECRETS', c: '#fca5a5', g: m.leaks.length ? 'text-shadow:0 0 12px rgba(239,68,68,.4);' : '' },
    { v: m.verdict ? (m.verdict.compromised ? 'BREACH' : 'SAFE') : (runId ? 'LIVE' : '—'), k: 'VERDICT',
      c: m.verdict && m.verdict.compromised ? '#fca5a5' : '#34d399', g: m.verdict && m.verdict.compromised ? 'text-shadow:0 0 12px rgba(239,68,68,.4);' : '' },
  ];
  var inPlay = {};
  for (var ci = 0; ci < m.calls.length; ci++) {
    for (var t = 0; t < (m.calls[ci].techniques || []).length; t++) inPlay[m.calls[ci].techniques[t]] = true;
  }
  var tacs = Object.keys(inPlay);
  var h = '<div class="insphead"><span style="font-size:13px;">▣</span><span class="ttl">OPERATION DOSSIER</span></div>' +
    '<div class="card"><div class="klabel">MISSION</div><div class="mission">' + esc(scn ? scn.goal : 'No operation loaded.') + '</div></div>' +
    '<div class="statgrid">';
  for (var s = 0; s < stats.length; s++) {
    h += '<div class="stat"><div class="v" style="color:' + stats[s].c + ';' + stats[s].g + '">' + esc(stats[s].v) + '</div><div class="k">' + stats[s].k + '</div></div>';
  }
  h += '</div><div class="card" style="margin-bottom:0;"><div class="klabel" style="margin-bottom:8px;">TECHNIQUES IN PLAY</div>';
  h += tacs.length ? '<div>' + tacs.map(function (t2) { return '<span class="playchip">' + esc(t2) + '</span>'; }).join('') + '</div>'
    : '<div class="lootempty">None deployed yet.</div>';
  h += '<div class="insphint">▸ select a worker in the tree to inspect</div></div>';
  el.innerHTML = h;
}

// ── overlays ────────────────────────────────────────────────────────────────
function mapLayout() {
  var W = 760, H = 430;
  var depts = [], byDept = {};
  for (var i = 0; i < scn.roster.length; i++) {
    var d = scn.roster[i].department;
    if (!byDept[d]) { byDept[d] = []; depts.push(d); }
    byDept[d].push(scn.roster[i]);
  }
  var pos = { __root: { x: W / 2, y: 44 } };
  var deptPos = {};
  for (var di = 0; di < depts.length; di++) {
    var dx = W * (di + 1) / (depts.length + 1);
    deptPos[depts[di]] = { x: dx, y: 145 };
    var ppl = byDept[depts[di]];
    for (var pi = 0; pi < ppl.length; pi++) {
      var spread = Math.min(140, (W / (depts.length + 1) - 30) / Math.max(ppl.length - 1, 1) * 2);
      var x = dx + (pi - (ppl.length - 1) / 2) * Math.max(spread, 95);
      pos[ppl[pi].id] = { x: Math.max(60, Math.min(W - 60, x)), y: 290 + (pi % 2) * 78 };
    }
  }
  return { W: W, H: H, depts: depts, byDept: byDept, pos: pos, deptPos: deptPos };
}
function edgeHtml(a, b, attack) {
  var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
  var base = 'position:absolute;left:' + a.x + 'px;top:' + a.y + 'px;height:' + (attack ? 3 : 2) + 'px;width:' + len + 'px;transform-origin:0 50%;transform:rotate(' + ang + 'deg);border-radius:2px;';
  return '<div style="' + base + (attack
    ? 'background:repeating-linear-gradient(90deg,#ef4444 0 7px,rgba(239,68,68,0) 7px 14px);background-size:14px 3px;animation:vdash .6s linear infinite;box-shadow:0 0 9px rgba(239,68,68,.6);z-index:2;'
    : 'background:linear-gradient(90deg,rgba(99,130,170,.32),rgba(99,130,170,.12));z-index:1;') + '"></div>';
}
function renderMapOverlay(m) {
  var L = mapLayout();
  var h = '<div class="ovbk" data-act="closeoverlay"><div class="ovbox" data-stop="1" style="width:900px;">' +
    '<div class="ovhead"><span style="font-size:15px;">🛰</span><span class="ttl">WORKER MAP · ATTACK SURFACE</span><div style="flex:1;"></div>' +
    '<div class="legend">' + ['idle', 'on_call', 'breached', 'contacted'].map(function (k) {
      var st = STAT[k];
      return '<div class="it"><span style="width:8px;height:8px;border-radius:50%;background:' + st.c + ';display:block;' + (k === 'idle' ? '' : 'box-shadow:0 0 7px ' + st.c + ';') + '"></span><span class="lb">' + st.label + '</span></div>';
    }).join('') + '</div>' +
    '<button class="ovclose" data-act="closeoverlay">✕</button></div>' +
    '<div class="mapwrap"><div class="mapcanvas" style="width:' + L.W + 'px;height:' + L.H + 'px;">';
  // org edges
  for (var d = 0; d < L.depts.length; d++) {
    h += edgeHtml(L.pos.__root, L.deptPos[L.depts[d]], false);
    var ppl = L.byDept[L.depts[d]];
    for (var p = 0; p < ppl.length; p++) h += edgeHtml(L.deptPos[L.depts[d]], L.pos[ppl[p].id], false);
  }
  // attack chain: every person of wave k → every person of wave k+1
  var waves = [];
  for (var c = 0; c < m.calls.length; c++) {
    var call = m.calls[c];
    if (!call.personId || !L.pos[call.personId]) continue;
    (waves[call.wave] = waves[call.wave] || []).push(call.personId);
  }
  waves = waves.filter(function (w) { return w && w.length; });
  for (var wv = 0; wv + 1 < waves.length; wv++) {
    for (var a = 0; a < waves[wv].length; a++) for (var b = 0; b < waves[wv + 1].length; b++) {
      h += edgeHtml(L.pos[waves[wv][a]], L.pos[waves[wv + 1][b]], true);
    }
  }
  h += '<div class="maproot" style="left:' + L.pos.__root.x + 'px;top:' + L.pos.__root.y + 'px;"><span style="font-size:13px;">🏢</span><span class="nm">' + esc(scn.id) + '</span></div>';
  for (var d2 = 0; d2 < L.depts.length; d2++) {
    h += '<div class="mapdept" style="left:' + L.deptPos[L.depts[d2]].x + 'px;top:' + L.deptPos[L.depts[d2]].y + 'px;">' + esc(L.depts[d2]).toUpperCase() + '</div>';
  }
  for (var i = 0; i < scn.roster.length; i++) {
    var w = scn.roster[i], st2 = STAT[workerStatus(m, w.id)], pp = L.pos[w.id], sel = worker === w.id;
    h += '<div class="mapnode" data-act="pickworker" data-arg="' + esc(w.id) + '" style="left:' + pp.x + 'px;top:' + pp.y + 'px;">' +
      '<div style="width:46px;height:46px;border-radius:50%;display:grid;place-items:center;font-family:\\'IBM Plex Mono\\',monospace;font-size:13px;font-weight:600;' +
      'color:' + st2.c + ';background:' + st2.bg + ';border:2px solid ' + st2.c + ';box-shadow:0 0 ' + (sel ? '18px' : '12px') + ' ' + st2.c + (sel ? 'aa' : '55') + ';' +
      (sel ? 'outline:2px solid ' + st2.c + ';outline-offset:3px;' : '') + '">' + esc(initials(w.name)) + '</div>' +
      '<div class="nm">' + esc(w.name.split(' ')[0]) + '</div>' +
      '<div class="tt">' + esc(w.title.split('·')[0].split('(')[0].trim()) + '</div>' +
      '<div class="bd" style="color:' + st2.c + ';">' + st2.label + '</div></div>';
  }
  h += '</div><div class="maphint">⌁ red path = realized attack chain · click any node to open its dossier</div></div></div></div>';
  return h;
}
function renderSessionOverlay() {
  var canStart = Object.keys(selTactics).some(function (k) { return selTactics[k]; });
  var h = '<div class="ovbk" data-act="closeoverlay"><div class="ovbox" data-stop="1" style="width:940px;max-width:94vw;">' +
    '<div class="ovhead"><span style="font-size:15px;">⧉</span><span class="ttl">NEW SESSION</span><div style="flex:1;"></div>' +
    '<button class="ovclose" data-act="closeoverlay">✕</button></div>' +
    '<div style="padding:18px 20px;">';
  // tactics
  h += '<div class="seclabel" style="margin-top:0;">TACTICS · SELECT ONE OR MORE</div><div class="libgrid" style="padding:0;width:auto;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));">';
  for (var i = 0; i < tacticsIndex.length; i++) {
    var t = tacticsIndex[i], on = !!selTactics[t.id];
    h += '<div class="libcard' + (on ? ' live' : '') + '" data-act="seltactic" data-arg="' + esc(t.id) + '" style="cursor:pointer;min-height:auto;">' +
      '<div class="top"><span class="dot"></span><span class="id">' + esc(t.name) + '</span>' +
      '<span class="tag">' + (on ? '✓ ON' : 'OFF') + '</span></div>' +
      '<div class="gl" style="min-height:auto;">' + esc(t.summary || '') + '</div></div>';
  }
  if (!tacticsIndex.length) h += '<div class="lootempty">No tactics found in data/tactics.</div>';
  h += '</div>';
  // workers map (preferred target)
  h += '<div class="seclabel">WORKERS MAP · CLICK TO MARK A PREFERRED TARGET (OPTIONAL)</div>';
  h += renderSessionMap();
  // start
  h += '<div style="display:flex;justify-content:flex-end;margin-top:16px;">' +
    '<button class="go" data-act="startsession" style="' + (canStart ? '' : 'opacity:.4;pointer-events:none;') + '">▸ START SESSION</button></div>';
  h += '</div></div></div>';
  return h;
}
function renderSessionMap() {
  if (!orgPublic || !orgPublic.roster.length) return '<div class="lootempty">No org loaded (data/org.json).</div>';
  var depts = [], byDept = {};
  for (var i = 0; i < orgPublic.roster.length; i++) {
    var d = orgPublic.roster[i].department || 'General';
    if (!byDept[d]) { byDept[d] = []; depts.push(d); }
    byDept[d].push(orgPublic.roster[i]);
  }
  var h = '<div style="display:flex;flex-wrap:wrap;gap:10px;">';
  for (var di = 0; di < depts.length; di++) {
    h += '<div style="flex:1;min-width:200px;border:1px solid #16283a;border-radius:10px;padding:10px;">' +
      '<div class="depthead"><span class="nm">' + esc(depts[di]) + '</span></div>';
    var ppl = byDept[depts[di]];
    for (var p = 0; p < ppl.length; p++) {
      var w = ppl[p], sel = prefTarget === w.id;
      h += '<div class="wcard' + (sel ? ' sel' : '') + '" data-act="preftarget" data-arg="' + esc(w.id) + '" style="margin-top:6px;">' +
        avatarHtml(w.name, STAT.idle, 26) +
        '<div style="flex:1;min-width:0;"><div class="nm">' + esc(w.name) + '</div><div class="tt">' + esc(w.title) + '</div></div>' +
        (sel ? '<span class="tag" style="color:#fbbf24;border:1px solid rgba(251,191,36,.5);border-radius:5px;padding:2px 6px;font-family:\\'IBM Plex Mono\\',monospace;font-size:8.5px;">★ TARGET</span>' : '') +
        '</div>';
    }
    h += '</div>';
  }
  h += '</div>';
  return h;
}
function renderOverlay(m) {
  var host = $('overlayHost');
  if (!overlay || (overlay === 'map' && (!scn || !scn.roster.length))) { host.innerHTML = ''; return; }
  host.innerHTML = overlay === 'map' ? renderMapOverlay(m) : renderSessionOverlay();
}

// ── master render ───────────────────────────────────────────────────────────
function render() {
  var m = derive(events.length);
  renderHeader(m);
  renderScenarioPanel();
  renderTree(m);
  renderLoot(m);
  renderProcess(m);
  renderInspector(m);
  renderOverlay(m);
  if (linkUp) {
    var c = document.querySelector('section.center');
    c.scrollTop = c.scrollHeight;
  }
}

// ── actions (event delegation) ─────────────────────────────────────────────
document.addEventListener('click', function (e) {
  var stopEl = e.target.closest('[data-stop]');
  var el = e.target.closest('[data-act]');
  // a click inside the modal box that isn't on one of its own actions must not
  // bubble out to the backdrop's closeoverlay
  if (stopEl && (!el || !stopEl.contains(el))) return;
  if (!el) return;
  var act = el.getAttribute('data-act'), arg = el.getAttribute('data-arg');
  if (act === 'panel') { panels[arg] = !panels[arg]; }
  else if (act === 'tactic') { tacticsOff[arg] = !tacticsOff[arg]; }
  else if (act === 'worker') { worker = arg || null; }
  else if (act === 'pickworker') { worker = arg; overlay = null; }
  else if (act === 'overlay') { overlay = arg; }
  else if (act === 'closeoverlay') { overlay = null; }
  else if (act === 'togglecall') {
    expandedOverride[arg] = !isExpanded(derive(events.length), arg);
  }
  else if (act === 'openrun') { connect(arg); return; }
  else if (act === 'newsession') { newSession(); return; }
  else if (act === 'seltactic') { selTactics[arg] = !selTactics[arg]; }
  else if (act === 'preftarget') { prefTarget = (prefTarget === arg ? null : arg); }
  else if (act === 'startsession') { startSession(); return; }
  render();
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay) { overlay = null; render(); } });

// ── run plumbing: launch / reopen / SSE replay+tail ────────────────────────
function loadScenarioDetail(id, cb) {
  fetch('/api/scenario?id=' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { scn = d; cb && cb(); }).catch(function () { scn = null; cb && cb(); });
}
function loadIndex(cb) {
  Promise.all([
    fetch('/api/scenarios').then(function (r) { return r.json(); }),
    fetch('/api/runs').then(function (r) { return r.json(); }),
  ]).then(function (res) { scenariosIndex = res[0]; runs = res[1]; cb && cb(); });
}
function connect(id) {
  if (es) es.close();
  runId = id; events = []; terminal = null; failedMsg = null; expandedOverride = {}; worker = null;
  localStorage.setItem('vish_run', id);
  if (/^session-/.test(id)) {
    fetch('/api/run-meta?run=' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (meta) {
        if (meta && meta.org) {
          scn = { id: meta.org.id, goal: (meta.tactics || []).map(function (t) { return t.name; }).join(' + '),
            maxHops: meta.maxHops || 5, roster: meta.org.roster, tactics: ALL_TECHNIQUES, persona: null,
            sessionTactics: meta.tactics || [], preferredTargetId: meta.preferredTargetId || null };
        } else { scn = null; }
        render();
      });
  } else {
    loadScenarioDetail(id.replace(/-\\d+$/, ''), render);
  }
  es = new EventSource('/api/stream?run=' + encodeURIComponent(id));
  es.onopen = function () { linkUp = true; events = []; terminal = null; render(); };
  es.onmessage = function (msg) { events.push(JSON.parse(msg.data)); render(); };
  es.addEventListener('done', function (msg) {
    terminal = JSON.parse(msg.data); linkUp = false; es.close();
    loadIndex(render); render();
  });
  es.addEventListener('failed', function (msg) {
    failedMsg = JSON.parse(msg.data).message; linkUp = false; es.close(); render();
  });
  es.onerror = function () { if (es.readyState === EventSource.CLOSED) { linkUp = false; render(); } };
  render();
}
// + NEW SESSION: drop the current operation and open the tactics-first session
// window — multi-select tactics + mark an optional preferred target, then launch.
function newSession() {
  if (es) es.close();
  es = null; linkUp = false; runId = null; events = []; terminal = null; failedMsg = null;
  expandedOverride = {}; worker = null; scn = null;
  selTactics = {}; prefTarget = null;
  localStorage.removeItem('vish_run');
  Promise.all([
    fetch('/api/tactics').then(function (r) { return r.json(); }),
    fetch('/api/org').then(function (r) { return r.ok ? r.json() : null; }),
  ]).then(function (res) {
    tacticsIndex = res[0] || []; orgPublic = res[1];
    overlay = 'session';
    loadIndex(render);
  });
}
function startSession() {
  var ids = Object.keys(selTactics).filter(function (k) { return selTactics[k]; });
  if (!ids.length) return;
  overlay = null; render();
  fetch('/api/session', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tacticIds: ids, preferredTargetId: prefTarget || undefined }),
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.error) { failedMsg = d.error; render(); return; }
    loadIndex(function () { connect(d.id); });
  });
}

loadIndex(function () {
  var wanted = new URLSearchParams(location.search).get('run') || localStorage.getItem('vish_run');
  if (wanted) connect(wanted); else render();
});
render();
</script>
</body></html>`;

// ── public scenario shapes (NEVER leak secrets/hints/target personas) ────────
interface RawRosterEntry {
  id: string; name?: string; title?: string; phone?: string;
  department?: string; publicInfo?: string;
}
interface RawScenario {
  campaignId?: string; goal?: string; maxHops?: number; roster?: RawRosterEntry[];
  targetId?: string; persona?: string; allowedTactics?: string[];
  objective?: { description?: string };
  facts?: Record<string, { key: string; value: string }[]>;
}

function publicScenario(id: string, raw: RawScenario) {
  const roster = (raw.roster ?? []).map((p) => ({
    id: p.id, name: p.name ?? p.id, title: p.title ?? '', phone: p.phone ?? '',
    department: p.department ?? 'General', publicInfo: p.publicInfo ?? '',
  }));
  if (roster.length === 0 && raw.targetId) {
    // single-call scenario: synthesize a one-person roster from the public facts
    const facts = raw.facts?.[raw.targetId] ?? [];
    const fact = (k: string) => facts.find((f) => f.key === k)?.value;
    roster.push({
      id: raw.targetId, name: fact('name') ?? raw.targetId, title: fact('role') ?? 'Direct target',
      phone: '', department: 'Target', publicInfo: '',
    });
  }
  return {
    id: raw.campaignId ?? id,
    goal: raw.goal ?? raw.objective?.description ?? '',
    maxHops: raw.maxHops ?? 1,
    tactics: raw.allowedTactics ?? null,
    persona: raw.persona ?? null,
    roster,
  };
}

async function readScenarioFile(id: string): Promise<RawScenario | undefined> {
  if (!/^[\w.-]+$/.test(id)) return undefined;
  try {
    return JSON.parse(await readFile(join(SCENARIOS_DIR, `${id}.json`), 'utf8')) as RawScenario;
  } catch {
    return undefined;
  }
}

async function listScenarios(): Promise<{ id: string; goal: string; maxHops: number; nodes: number }[]> {
  try {
    const files = (await readdir(SCENARIOS_DIR)).filter((f) => f.endsWith('.json'));
    const out = [];
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      const raw = await readScenarioFile(id);
      if (!raw) continue;
      const pub = publicScenario(id, raw);
      out.push({ id, goal: pub.goal, maxHops: pub.maxHops, nodes: pub.roster.length });
    }
    return out;
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
  meta?: { kind: 'session'; orgId: string; tactics: { id: string; name: string }[]; preferredTargetId?: string; maxHops: number };
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
      // stamp wall-clock time so the dashboard can show T+ and call durations
      const stamped = { ...ev, ts: Date.now() };
      run.events.push(stamped);
      for (const res of run.listeners) sse(res, null, stamped);
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

// Launch a tactics-first session run server-side. Mirrors startRun, but drives
// runSession (org-backed, operator picks the targets) and persists a __meta
// header so a reopened session can rebuild its workers map without a scenario.
function startSession(tacticIds: string[], preferredTargetId: string | undefined, meta: NonNullable<LiveRun['meta']>): LiveRun {
  const id = `session-${Date.now()}`;
  const run: LiveRun = { id, scenario: 'session', events: [], status: 'running', listeners: new Set(), meta };
  liveRuns.set(id, run);

  (async () => {
    const bus = new InMemoryEventBus();
    bus.subscribe((ev) => {
      const stamped = { ...ev, ts: Date.now() };
      run.events.push(stamped);
      for (const res of run.listeners) sse(res, null, stamped);
    });
    try {
      run.result = await runSession({ tacticIds, preferredTargetId }, bus);
      run.status = 'done';
    } catch (e) {
      run.status = 'failed';
      run.error = e instanceof Error ? e.message : String(e);
    }
    try {
      await mkdir(LOG_DIR, { recursive: true });
      const lines = [JSON.stringify({ __meta: run.meta })];
      for (const e of run.events) lines.push(JSON.stringify(e));
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
      if (item.__meta) { run.meta = item.__meta as LiveRun['meta']; continue; }
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

  // Public scenario detail for the command center: roster (org tree / map /
  // dossiers), goal, hop budget, sanctioned tactics. Secrets, hints, and target
  // personas are stripped server-side and never reach the browser.
  if (url.pathname === '/api/scenario') {
    const id = url.searchParams.get('id') ?? '';
    const raw = await readScenarioFile(id);
    if (!raw) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'unknown scenario' })); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(publicScenario(id, raw)));
  }

  // Start a run server-side and return its id. The run keeps going regardless of
  // whether any browser is connected.
  if (url.pathname === '/api/launch') {
    const scenario = url.searchParams.get('scenario') ?? '';
    if (!(await readScenarioFile(scenario))) {
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

  // Public org view for the new-session picker (workers map). Secret-free: only
  // org.public (id / name / secret-stripped roster) ever reaches the browser.
  if (url.pathname === '/api/org') {
    const org = await loadOrg().catch(() => null);
    res.writeHead(org ? 200 : 404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(org ? org.public : { error: 'no org' }));
  }

  // Available tactics (id / name / summary) for the session picker.
  if (url.pathname === '/api/tactics') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(await listTactics()));
  }

  // Metadata for a run: lets the client rebuild the workers map for a reopened
  // session run (which has no scenario file).
  if (url.pathname === '/api/run-meta') {
    const id = url.searchParams.get('run') ?? '';
    const run = liveRuns.get(id) ?? (await loadRunFromDisk(id));
    if (!run || !run.meta) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'no meta' })); }
    const org = await loadOrg().catch(() => null);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ...run.meta, org: org ? org.public : null }));
  }

  // Launch a tactics-first session: the operator picks targets from the org.
  if (url.pathname === '/api/session' && req.method === 'POST') {
    const body = await new Promise<string>((resolve) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => resolve(s)); });
    let parsed: { tacticIds?: unknown; preferredTargetId?: unknown };
    try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
    const tacticIds = Array.isArray(parsed.tacticIds) ? parsed.tacticIds.filter((x): x is string => typeof x === 'string') : [];
    const preferredTargetId = typeof parsed.preferredTargetId === 'string' ? parsed.preferredTargetId : undefined;
    if (tacticIds.length === 0) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'select at least one tactic' })); }
    const org = await loadOrg().catch(() => null);
    const list = await listTactics();
    const names = new Map(list.map((t) => [t.id, t.name]));
    const meta = {
      kind: 'session' as const,
      orgId: org?.id ?? 'org',
      tactics: tacticIds.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
      preferredTargetId,
      maxHops: 5,
    };
    if (meta.tactics.length === 0) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'unknown tactics' })); }
    const run = startSession(tacticIds, preferredTargetId, meta);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id: run.id }));
  }

  res.writeHead(404); res.end('not found');
}).listen(PORT, () => {
  console.log(`VishShield command center → http://localhost:${PORT}`);
});
