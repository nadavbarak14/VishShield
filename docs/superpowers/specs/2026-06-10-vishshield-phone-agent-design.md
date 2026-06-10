# VishShield — Autonomous Vishing-Simulation Phone Agent

**Design doc · 2026-06-10**

## 1. What we're building

An autonomous, goal-directed voice agent that runs **authorized, consented vishing
(voice-phishing) simulations** against an organization's own high-risk roles
(IT helpdesk, SREs with prod access, finance/AP). The agent places a real phone
call, improvises a hyper-credible social-engineering conversation built from real
company signal, attempts to obtain a defined objective (an MFA code, a password
reset, a prod token, a wire-detail change), and — the moment it succeeds or the
call ends — **breaks character to coach the employee in the moment.**

The output is an organization-level resilience report: *which tactics cracked which
roles, and where the kill chain could have been broken* — not a per-individual
blame sheet.

### Why it matters
- Security-awareness training is a proven market, but ~all of it is **email** phishing.
  **Voice is the underserved, fastest-growing flank** — AI just removed the two
  barriers that made vishing rare (it didn't scale; it needed good intel).
- The exact attack we simulate (helpdesk → MFA reset → escalation) is how the 2023
  MGM / Caesars / Okta breaches happened ("Scattered Spider"). This is not hypothetical.

### Ethical frame (a feature, not an afterthought)
- **Consent + scope:** opt-in roster, security team authorizes, full audit trail.
- **Org-level measurement,** not name-and-shame.
- **Train in the moment, positively** (the break-character debrief).
- First customer framing can be a **red-team / pentest tool** (consent via engagement
  contract), which sidesteps the "running it on your own staff" discomfort entirely.

## 2. The control model: goal + playbook, improvised live

The agent is **neither scripted nor unboundedly autonomous.** It is handed four
things and reasons turn-by-turn:

1. **Objective** — the prize to extract.
2. **Playbook** — a set of named, in-bounds social-engineering tactics it may choose
   among (grounded in real influence research + real breach TTPs):
   *pretext, authority, urgency, social proof, foot-in-the-door, borrowed legitimacy
   (cite a fact/ticket from a prior call — this is the chain), rapport.*
3. **Knowledge base** — mocked company facts (GitHub activity, who's OOO, org chart, tickets).
4. **Memory** — the live transcript plus intel carried between calls.

Live loop: *pick a tactic → deliver → read the reaction → escalate / pivot / chain.*
**Logging which tactic cracked which person IS the analytics.**

**Operator control:** sets the objective + connects data + checks which tactics are
in-bounds (default-on for MVP). The agent decides everything else live. "Decided
together" = operator sets the fence, agent improvises within it.

## 3. Architecture

### Organizing principle
Separate **the brain** (deciding what to say) from **the mouth & ears** (telephony +
voice). They communicate through **nothing but text turns.** Consequences:
- The unknown — **Dial** — sits behind a single adapter.
- Everything else is built and demoed **with no phone at all**, via a mock Call
  Engine that is a text loop where a **second LLM plays the victim** (or a human types).
- "Going live on Dial" swaps **only that one adapter**; nothing upstream changes.

**Every block is swappable behind a stable contract — including the Agent itself.**
For the MVP the **Agent (brain) is Claude Code / the Claude Agent SDK** (fastest to
demo; the audience watches it reason and act). It will later be replaced by a
purpose-built real-time voice agent, so **nothing else may depend on Claude-Code
specifics** — the Agent only ever sees an `AgentSession` and emits turns + tool calls.
Whether it pulls facts via a live tool call or has them pre-loaded into its prompt is
the Agent's *internal* business; the Knowledge Base contract is unaffected.

The **Target** (the person on the other end) is **not a product block** — in mock mode
it's a test fixture (a second Claude persona) living inside the mock Call Engine; in
production it's a real human reached via Dial, and no VishShield code represents it.

**Visuals are a consumer of an event stream, not a coupled component.** Every block
emits structured events (`call.started`, `agent.tactic_selected`, `agent.turn`,
`target.turn`, `intel.recorded`, `next_call.requested`, `call.ended`, `score.ready`)
to an **Event Bus** (append JSONL + an SSE endpoint). The terminal renders them for the
MVP; a minimal web view renders the *same stream* ("some visuals"); a full dashboard
later is just a richer consumer. The Agent and Call Engine never know who is watching.

### Block diagram

```
┌─────────────┐     campaign config      ┌──────────────────┐
│  Dashboard  │ ───────────────────────▶ │   Orchestrator   │
│  + API      │ ◀─── results / live ──── │  (control plane) │
└─────────────┘                          └────────┬─────────┘
                                                   │ builds agent session
                          ┌────────────────────────┼───────────────────────┐
                          ▼                         ▼                        ▼
                 ┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
                 │  Knowledge Base  │     │   Call Engine    │     │   Intel Store   │
                 │  (context)       │     │  ADAPTER ⇄ Dial  │     │  (memory/chain) │
                 │  mock: JSON      │     │  mock: text loop │     │  mock: in-mem   │
                 └──────────────────┘     └────────┬─────────┘     └─────────────────┘
                                          text turns │ ▲ text turns
                                                     ▼ │
                                          ┌──────────────────┐     ┌─────────────────┐
                                          │ Conversation     │────▶│     Scorer      │
                                          │ Agent (the brain)│ txt │  (LLM judge)    │
                                          │ LLM + tools      │     └─────────────────┘
                                          └──────────────────┘
```

### Blocks and their stable contracts

| Block | Purpose | Stable interface | Now (MVP) → Swap target |
|---|---|---|---|
| **Orchestrator** | Owns a campaign; sequences calls; carries intel between hops | `runCampaign(config)` | launcher script → service |
| **Agent** (brain) | What to say, which tactic, when to escalate/chain | `AgentSession` in → turns + tool calls out | **Claude Code / Agent SDK → custom real-time voice agent** |
| **Knowledge Base** | Supplies company facts for the pretext | `getContext(targetId) → Facts` | static JSON → GitHub/Calendar APIs |
| **Call Engine** | Transport: deliver agent words, return the other end's | `startCall(number, voice, session)`; emits `targetTurn`, consumes `agentTurn`; `onEnd(transcript)` | **mock text channel → Dial adapter** |
| **Target** (fixture, mock only) | Stand-in for the human on the other end | text turn in → text turn out | second Claude persona → real human (no code) |
| **Intel Store** | Persists extracted facts; makes later hops smarter | `recordIntel(campaignId, fact)` / `getIntel(campaignId)` | in-memory / JSONL → DB |
| **Scorer** | Post-call: complied? which tactic? failure point | `score(transcript, objective) → Result` | Claude pass → tuned judge |
| **Event Bus** | Decouples visuals from logic | `emit(event)` / `subscribe()` | JSONL + SSE → message queue |
| **Visualizer** | Renders the run | consumes Event Bus | terminal + minimal web → full dashboard |

### Interface sketches (the contracts that never change)

```ts
// ---- Call Engine ↔ Agent: pure text turns (extensible via optional metadata) ----
interface Turn {
  speaker: 'agent' | 'target';
  text: string;
  meta?: { hesitationMs?: number; interrupted?: boolean }; // additive only
}

interface AgentSession {
  objective: Objective;
  allowedTactics: Tactic[];
  facts: Facts;          // from Knowledge Base
  intel: Fact[];         // from Intel Store (prior hops)
}

interface CallEngine {
  startCall(number: string, voice: VoiceId, session: AgentSession): CallHandle;
  // emits 'userTurn' (Turn), consumes agentTurn (string), emits 'end' (Transcript)
}

// ---- The brain (realized by Claude Code / Agent SDK for the MVP) ----
// The Agent consumes an AgentSession and drives the conversation via tool calls.
// Its conceptual per-turn contract:
interface ConversationAgent {
  respond(targetTurn: Turn, state: ConversationState):
    Promise<{ agentTurn: string; toolCalls: ToolCall[] }>;
}

// Agent tools (how it acts on the world):
//   record_intel(fact)            -> Intel Store
//   objective_achieved()         -> triggers debrief mode
//   request_next_call(target, reason) -> Orchestrator sequences the next hop
//   switch_to_debrief()          -> break character, coach the employee

// ---- Knowledge Base ----
interface KnowledgeBase { getContext(targetId: string): Promise<Facts>; }

// ---- Intel Store ----
interface IntelStore {
  recordIntel(campaignId: string, fact: Fact): Promise<void>;
  getIntel(campaignId: string): Promise<Fact[]>;
}

// ---- Scorer ----
interface Scorer {
  score(transcript: Transcript, objective: Objective): Promise<{
    outcome: 'compromised' | 'resisted' | 'partial';
    tacticAttribution: { tactic: Tactic; effect: string }[];
    failurePoint?: string;       // where the human could have stopped it
    teachableMoments: string[];
  }>;
}
```

### Data flow (this is what stays fixed)

1. Operator defines a campaign → Dashboard POSTs to **Orchestrator**.
2. Orchestrator pulls target facts from **Knowledge Base** + prior **Intel**.
3. It assembles an **AgentSession** and tells the **Call Engine** to start.
4. Per target turn: Call Engine → `respond()` on the **Agent** → speaks the reply.
   Agent emits tool calls: `record_intel`, `request_next_call`,
   `objective_achieved` / `switch_to_debrief`.
5. Call ends → transcript → **Scorer** → result stored.
6. Dashboard streams the live transcript and shows the scorecard + kill-chain.

### The chain (multi-hop)
- The **Agent requests** the next hop (`request_next_call`); the **Orchestrator owns**
  sequencing and carries intel forward. Deterministic control flow + autonomous feel.
- Hop 2's `AgentSession.intel` includes facts extracted in hop 1 (e.g. a ticket
  number), which the `borrowed legitimacy` tactic uses to land.

## 4. Real-time feasibility (if Dial is "just a number + a voice")

The intelligence is a solved, shipping pattern (this is what Vapi/Retell/Bland do).
The bottleneck is **latency + turn-taking**, not smartness. If Dial is a dumb pipe,
*we* own the loop: `STT → LLM → TTS`, target round-trip **< ~1s** (a ~1s pause reads
as natural on a phone). Techniques: stream + overlap (start TTS on the first sentence),
VAD for endpointing, barge-in handling, and **front-load all context into the system
prompt** so mid-call there is no heavy retrieval. Pivotal unknown to confirm on Dial:
**does it hand us transcribed text (easy) or raw audio (we add managed STT/TTS).**
Either way only the **thickness of the Call Engine adapter** changes — the design holds.

## 5. Demo plan

- **Anchor (live):** Scenario A — "The 2 AM Deploy." Mock KB: a PR merged to
  `payments-service` 25 min ago by *Dana Liu*; *Alex* on-call; *Sarah* (owner) OOO till
  Thursday. Agent calls Alex, improvises off the real deploy, target slips, agent
  breaks character and coaches; dashboard scores it.
- **Chain (second):** Scenario B — "The Locked-Out Traveler." Helpdesk → sysadmin,
  2 hops, the ticket number from call 1 makes call 2 land. ("This is how MGM was breached.")
- **Fallback:** if live telephony is flaky, run the **mock Call Engine** (LLM-victim
  text loop) and frame real calls as the deployed mode. Same brain, same dashboard.

## 6. MVP scope

**Build:** TypeScript. The **Agent is Claude Code / the Agent SDK** driven by the
Orchestrator launcher; the agent's tools (`say_to_target`, `get_company_data`,
`record_intel`, `request_next_call`, `end_call_and_debrief`) are the seams to every
other block. Each block is a module behind its interface, implementation chosen by env
flag (`CALL_ENGINE=mock|dial`, `KB=mock|github`). Blocks shipping for the MVP:
Orchestrator (launcher), Agent (Claude Code + tools), Knowledge Base (mock JSON),
Intel Store (in-memory/JSONL), Scorer (Claude pass), Call Engine (mock text channel
first, Dial adapter if confirmed), Event Bus (JSONL + SSE), Visualizer (terminal +
minimal web view).

**Cut to roadmap (state out loud, so it reads as intentional):** voice cloning; live
data-source integrations (real GitHub/Calendar APIs); autonomous target selection;
multi-tenant; the full tactic-permission UI; persistent DB.

## 7. Parallelization

The four stable seams let four people work without collisions:
**Call Engine↔Agent** (text turns) · **Agent↔Knowledge Base** (`getContext`) ·
**Agent↔Intel Store** (`record/get`) · **Orchestrator↔Scorer** (transcript→result).
Swap Dial in, swap real GitHub data in, swap a better model in — none touch the others.

## 8. Open items to confirm
- Dial's actual API: text-back vs raw-audio; tool/function-calling support; how a call
  is triggered; how transcripts stream.
- Voice source for the agent (Dial-provided voice vs managed TTS).
