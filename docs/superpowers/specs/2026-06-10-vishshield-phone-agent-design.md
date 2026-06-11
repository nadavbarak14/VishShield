# VishShield — Autonomous Vishing-Simulation Phone Agent

**Design doc · 2026-06-10 (rev 2026-06-11)**

## 1. What we're building

An autonomous, goal-directed voice agent that runs **authorized, consented vishing
(voice-phishing) simulations** against an organization's own high-risk roles
(IT helpdesk, SREs with prod access, finance/AP). The agent holds a phone
conversation, improvises a hyper-credible social-engineering pretext built from real
company signal, attempts to obtain a defined objective (an MFA code, a password
reset, a prod token, a wire-detail change), and — when it succeeds or the call ends —
**breaks character to coach the employee in the moment.**

The intended output is an organization-level resilience picture: *which tactics
cracked which roles* — not a per-individual blame sheet.

### Why it matters
- Security-awareness training is a proven market, but ~all of it is **email** phishing.
  **Voice is the underserved, fastest-growing flank** — AI removed the two barriers
  that made vishing rare (it didn't scale; it needed good intel).
- The exact attack we simulate (helpdesk → MFA reset → escalation) is how the 2023
  MGM / Caesars / Okta breaches happened ("Scattered Spider"). Not hypothetical.

### Ethical frame
Consent + scope (opt-in roster, security team authorizes), org-level measurement (not
name-and-shame), train-in-the-moment (the break-character debrief). The cleanest first
customer framing is a **red-team / pentest tool** (consent via engagement contract).
*An Authorization/Audit gate is planned but deferred past the first "just play" milestone.*

## 2. Control model: a thin agent, a smart orchestrator

The single most important boundary:

> **The phone Agent is *only a talker.*** It receives a session (objective + playbook +
> the facts already selected for it) and holds one conversation. **Everything else —
> knowledge-base access, persistence, key-info extraction, and multi-call sequencing —
> lives in the Orchestrator.**

This keeps the Agent trivially swappable (a real-time voice agent later does the same
one job) and keeps all control flow deterministic and inspectable.

**The Agent** is handed, per conversation:
1. **Objective** — the prize to extract.
2. **Playbook** — named, in-bounds social-engineering tactics it may choose among
   (grounded in real influence research + breach TTPs): *pretext, authority, urgency,
   social proof, foot-in-the-door, borrowed legitimacy, rapport.*
3. **Facts** — the relevant company signal the Orchestrator already pulled from the KB.

It loops: *pick a tactic → say it → read the reply → adapt → …* until it decides it's
done. Its **only tool is `say_to_target(text) → reply`** (plus an optional
`end_conversation(outcome?)` signal). It does **not** touch the KB and does **not**
save anything.

**The Orchestrator** owns the operation: query KB → pick relevant facts → build the
session → run the conversation → save the full transcript → extract key info → decide
the next hop (seeding it with what was learned).

## 3. Architecture

### Organizing principle
Separate **the brain** (deciding what to say) from **the mouth & ears** (telephony +
voice); they communicate through **nothing but text turns**, so the unknown — **Dial** —
sits behind one adapter and everything is built and demoed **with no phone at all**.

**Every block is swappable behind a stable contract — including the Agent and the LLM
itself.** For the MVP the Agent is the **Claude Agent SDK** (see §4). For tests, the
Agent and Target are swapped for **scripted responders** so the loop runs
deterministically and offline (see §6).

The **Target** (person on the other end) is **not a product block** — in mock mode it's
a test fixture (a second Claude, or a scripted responder); in production it's a real
human reached via Dial, represented by no VishShield code.

**Visuals are a consumer of an event stream.** Every block emits structured events to an
**Event Bus** (append JSONL + an SSE endpoint); the terminal renders them now, a web
dashboard later — the core loop never waits on it.

### Block diagram

```
                 ┌──────────────────────────────────────────────┐
                 │                 OPERATOR                      │
                 │  campaign: objective · target · tactics       │
                 └──────────────────────┬───────────────────────┘
                                        │ campaign config
                                        ▼
     ┌──────────────────────────── ORCHESTRATOR ───────────────────────────┐
     │  the brain of the operation (NOT the conversation):                  │
     │   1. query KB ──▶ pick relevant facts                                │
     │   2. build AgentSession (objective + playbook + facts)               │
     │   3. run conversation ────────────────────────────┐                  │
     │   4. agent finishes ─▶ save full transcript        │                  │
     │   5. EXTRACT key info from transcript ─▶ save       │                  │
     │   6. decide next hop (seed w/ extracted info) ◀─────┘ (loop)          │
     └───┬───────────────────┬──────────────────────┬──────────────┬────────┘
         │ getContext        │ AgentSession         │ save          │ extract+save
         ▼                   ▼                      ▼               ▼
  ┌────────────┐   ┌─────────────────────┐  ┌──────────────┐ ┌──────────────┐
  │ KNOWLEDGE  │   │      THE AGENT       │  │ CONVERSATION │ │  KEY-INFO    │
  │   BASE     │   │  Claude Agent SDK    │  │   STORE      │ │  STORE       │
  │ basic JSON │   │ (your SUBSCRIPTION)  │  │ full         │ │ important    │
  │ [▸ real    │   │ [▸ voice agent]      │  │ transcripts  │ │ facts (sep.) │
  │  sources]  │   │                      │  └──────────────┘ └──────────────┘
  └────────────┘   │  ONLY tool:          │
                   │  say_to_target(text) │
                   │      → reply         │
                   └──────────┬───────────┘
                       say    │  ▲ reply
                              ▼  │
                   ┌──────────────────────┐
                   │     CALL ENGINE      │
                   │     text channel     │
                   │     [▸ DIAL]         │
                   │   ┌──────────────┐   │
                   │   │   TARGET     │   │  ← mock-only fixture
                   │   │ 2nd Claude / │   │    [▸ real human, no code]
                   │   │ scripted     │   │
                   │   └──────────────┘   │
                   └──────────────────────┘

   ══════════════════════════════════════════════════════════════════════
    EVENT BUS (JSONL + SSE · side-channel · core loop never waits on it)
    emits: call.started · agent.turn · target.turn · call.ended
   ══════════════════════════════════════════════════════════════════════
                │ subscribe
                ▼
        ┌──────────────────────────────┐
        │ VISUALIZER: terminal renderer │
        │ [▸ web dashboard later]       │
        └──────────────────────────────┘
```

### Blocks and their stable contracts

| Block | Purpose | Stable interface | Now (MVP) → Swap target |
|---|---|---|---|
| **Orchestrator** | Owns the campaign: KB access, session build, persistence, extraction, sequencing | `runCampaign(config)` | launcher script → service |
| **Agent** (talker) | Hold one conversation toward the objective | `AgentSession` in → drives turns via `say_to_target` | **Claude Agent SDK → real-time voice agent**; **scripted in tests** |
| **Knowledge Base** | Supply company facts (read by Orchestrator only) | `getContext(targetId) → Facts` | basic JSON → real sources |
| **Call Engine** | Transport: deliver agent words, return the other end's reply | `startCall(session)`; `say(text) → targetTurn`; `onEnd(transcript)` | **mock text channel → Dial adapter** |
| **Target** (fixture, mock only) | Stand-in for the human | text turn in → text turn out | 2nd Claude / scripted → real human (no code) |
| **Conversation Store** | Persist every full transcript (structured) | `save(conversation)` / `get(id)` | JSONL → DB |
| **Key-Info Store** | Persist important extracted facts, separately | `put(campaignId, fact)` / `get(campaignId)` | JSONL → DB |
| **Event Bus** | Decouple visuals from logic | `emit(event)` / `subscribe()` | JSONL + SSE → queue |
| **Visualizer** | Render the run | consumes Event Bus | terminal → web dashboard |

*No LLM "judge"/Scorer in the MVP.* Scoring ("which tactic cracked them") is deferred;
because transcripts are saved **structured** (turns + tactic tags), it can be added
later with zero rework.

### Interface sketches (the contracts that stay fixed)

```ts
interface Turn { speaker: 'agent' | 'target'; text: string;
                 meta?: { hesitationMs?: number; interrupted?: boolean }; } // additive only

interface AgentSession {
  objective: Objective;
  allowedTactics: Tactic[];
  facts: Fact[];          // selected by the Orchestrator from the KB
}

// The Agent's only outward action. In mock = text channel; in real = Dial.
interface CallEngine {
  startCall(session: AgentSession): CallHandle;
  // CallHandle.say(text) resolves with the target's reply Turn; onEnd → full transcript
}

// The Agent itself: realized by the Claude Agent SDK (MVP) or a scripted responder (tests).
// Contract = "given a session and a CallEngine, conduct a conversation."
interface Agent { run(session: AgentSession, call: CallHandle): Promise<Transcript>; }

interface KnowledgeBase { getContext(targetId: string): Promise<Fact[]>; }
interface ConversationStore { save(c: Conversation): Promise<void>; get(id: string): Promise<Conversation>; }
interface KeyInfoStore { put(campaignId: string, fact: Fact): Promise<void>; get(campaignId: string): Promise<Fact[]>; }

// Orchestrator-owned, runs AFTER a conversation ends (not the agent, not a "judge"):
interface KeyInfoExtractor { extract(transcript: Transcript, objective: Objective): Promise<Fact[]>; }
```

### Data flow (fixed)
1. Operator defines a campaign → **Orchestrator**.
2. Orchestrator reads relevant facts from **Knowledge Base**, builds an **AgentSession**.
3. Orchestrator runs the conversation: **Agent** drives `say_to_target` through the
   **Call Engine** ↔ **Target**, emitting events to the **Event Bus**.
4. Agent finishes → Orchestrator saves the transcript to the **Conversation Store**.
5. Orchestrator runs the **Key-Info Extractor** over the transcript → **Key-Info Store**.
6. Orchestrator decides the next hop (seeded with extracted info) and loops, or ends.

### The chain (multi-hop)
Sequencing is **entirely the Orchestrator's**. After a conversation it inspects the
saved transcript + extracted info and decides whether to launch the next hop, seeding
that session's `facts` with what was learned (e.g. a ticket number) so the next
conversation can use `borrowed legitimacy`. For the MVP the two-hop sequence is
**hard-coded**, not agent-driven.

## 4. The Agent: Claude Agent SDK on your subscription

The Agent is the **Claude Agent SDK**, which runs the `claude` CLI under the hood and
therefore authenticates with your **Claude Pro/Max subscription** — no per-token API
key. Good for a hackathon (zero API cost). Caveat: subscription auth is rate-limited
and meant for interactive use, and the Agent, the Target-Claude, and the extraction
step all draw on it — fine for demos, not for high parallelism.

The SDK runs an agent loop with one custom tool, `say_to_target`. When the agent calls
it, the call **blocks until the Call Engine returns the target's reply**, then the agent
continues. This one pattern maps identically to mock (reply from a Claude/scripted
fixture) and real (reply = endpointed transcript from Dial). Streaming / barge-in is a
deliberately deferred Phase-2 concern.

## 5. Real-time feasibility (Phase 2, when Dial is real)
The intelligence is a solved pattern (Vapi/Retell/Bland). The bottleneck is **latency +
turn-taking**, not smartness. If Dial hands us **text**, the Call Engine adapter is thin;
if **raw audio**, we add managed STT/TTS and own endpointing/barge-in — a different
integration surface, deferred. The honest caveat: the Agent's **turn/timing model**
changes when it becomes a real-time voice agent — the *data* contracts survive, the
timing does not. We are consciously punting that past the hackathon.

## 6. MVP scope, milestones, and testing

**Stack:** TypeScript. Each block is a module behind its interface; implementation chosen
by env flag (`CALL_ENGINE=mock|dial`, `AGENT=claude|scripted`, `TARGET=claude|scripted`).

**Milestone 1 — "just play" (first target):** Orchestrator builds a session from a
hard-coded fact or two → **Agent (Claude SDK)** and **Target (Claude)** hold a
conversation over the **mock text Call Engine** → transcript prints and saves. This is
the runnable thing we iterate on; every other block is stubbed minimally, then deepened.

**Then, independently deepen:** Knowledge Base, Key-Info Extractor + Store, the terminal
Visualizer, Scenario A/B content, and the Dial adapter.

**Cut to roadmap:** voice cloning; live data-source integrations; autonomous target
selection; multi-tenant; tactic-permission UI; persistent DB; LLM scoring;
Authorization/Audit gate.

### Testing strategy
Two distinct paths:

1. **Live "play" run (manual, uses the subscription):** a script/command that runs a
   real conversation between the Claude Agent and a Claude Target so we can watch it
   actually play. **Not in CI** — it's non-deterministic, costs subscription quota, and
   needs auth. Run it locally on demand.

2. **Mock conversation tests (deterministic, offline, fast — these gate CI):** swap both
   the Agent and the Target for **scripted responders** (canned turn lists). The whole
   loop — Orchestrator → Call Engine → stores → extraction → Event Bus — runs with **no
   network and no LLM calls**. These are the **system tests**: assert the conversation
   plays end-to-end, the transcript is saved correctly, key-info extraction produces the
   expected facts (extractor also runs against fixed transcripts with a stubbed/real-but-
   recorded result), and the right events are emitted in order.

**CI must stay fast:** CI runs only path 2 (scripted, offline). No live LLM calls, no
sleeps, no real telephony. Target: full suite in seconds. The live play run and any
real-Claude extraction checks are a separate, manually-triggered job.

## 7. Parallelization
Stable seams let people work without collisions: **Orchestrator↔Agent** (`AgentSession`
+ `CallEngine`) · **Orchestrator↔KB** (`getContext`) · **Orchestrator↔stores**
(`save`/`put`) · **Call Engine↔Target** (text turns) · **everyone↔Event Bus** (`emit`).
Swap Dial in, swap real KB in, swap a voice agent in — none touch the others.

## 8. Open items
- Dial's actual API: text-back vs raw-audio; how a call is triggered; how transcripts stream.
- Voice source (Dial-provided vs managed TTS).
- Exact shape of the Key-Info Extractor (rules vs a small Claude call) — basic for now.
