# VishShield — Multi-Hop Operator Agent

**Design doc · 2026-06-11**

Builds on `2026-06-10-vishshield-phone-agent-design.md`. This implements that doc's
deferred **"The chain (multi-hop)"** section, but replaces its hard-coded, fact-seeded
sequencing with an **agent-driven operator**.

## 1. What we're adding

Today VishShield runs **one** call: a thin talker Agent works one objective against one
Target, the Orchestrator saves the transcript and extracts the leaked secret. This adds:

1. **A people knowledge base** — a roster of real-ish people, each with `id, name,
   title, phone, department, publicInfo`. The attacker side sees only this public profile.
2. **An Operator Agent** — *one continuous Claude session* that runs the whole
   engagement. It decides who to call and with what pretext, receives the full transcript
   of each call, decides what's worth remembering, and decides what to do next — call
   someone else, retry differently, or stop. **Multi-hop is just this one agent looping.**
3. **Per-operation persistence** — every call's full transcript saved to a `calls/` dir,
   and the operator's distilled "important info" appended to a `memory.md` text file.

### Key principle (from the user)

> Multi-hop is **one instance of a Claude agent** that receives the result of a call and
> decides what to do next. The **operator is a single session** (it remembers everything
> itself). The **calling agents are new every time**, with different instructions.

We therefore do **not** extract structured facts and thread them between calls. The
operator's own session context *is* the memory; `memory.md` is its human-readable
externalization, written when the operator says what mattered.

## 2. Architecture

```
┌─ OPERATOR AGENT  (one persistent `claude -p --resume` session = memory) ─┐
│  given: the engagement goal + the people roster (public profiles)         │
│  each turn: distill what mattered from the last call, then choose:         │
│      • call(personId, persona, objective, tactics)   • stop(reason)        │
└───────────────┬───────────────────────────────────────▲──────────────────┘
        decision │ {important, action}                    │ full transcript + outcome
                 ▼                                         │
   ┌──────────────────────── ORCHESTRATOR: runOperation ──┴──────────────────┐
   │  loop:                                                                    │
   │   1. operator.decideNext(lastCallResult) → {important, action}            │
   │   2. append `important` → data/runs/<op>/memory.md                        │
   │   3. if action == stop: break                                            │
   │   4. person = roster.getPerson(action.personId)                          │
   │   5. run ONE call  (reuses runCampaign: fresh talker ↔ Target)           │
   │   6. save transcript → data/runs/<op>/calls/hop-N-<personId>.json         │
   │   7. lastCallResult = { transcript, leaked }   → back to step 1           │
   │  save data/runs/<op>/operation.json                                       │
   └───────────────────────────────────┬──────────────────────────────────────┘
                                        ▼  (UNCHANGED today's machinery)
                     fresh talker Agent ↔ Call Engine ↔ Target  +  Event Bus
```

The boundary that already exists — thin talker Agent, smart Orchestrator — is preserved.
The Operator sits **above** `runCampaign`; `runCampaign` itself, the talker Agent, Call
Engine, Target, stores, extractor, and Event Bus are **untouched**.

### Why `claude -p --resume` for the operator

`claude -p --output-format json` returns a stable `session_id`; passing
`--resume <session_id>` continues the same conversation with full memory. Verified
2026-06-11 (operator recalled a codeword set on the first turn after a resume). This gives
a true single-session agent **on the Pro/Max subscription** (no API key, no Agent SDK),
consistent with the base design's `claude -p` decision. The operator does not use real
filesystem/MCP tools; it returns a structured decision and the Orchestrator performs the
I/O on its behalf — deterministic, inspectable, and testable with a scripted operator.

## 3. New / changed components

Everything is **additive** except a small, backward-compatible branch in `runScenario` and
two new fields on existing types. The single-call path (`scenario-a`, `runCampaign`,
`MockKnowledgeBase`, `ClaudeAgent`, all existing tests) is **unchanged**.

| Component | Kind | Responsibility |
|---|---|---|
| `Person`, `Operator`, `OperatorDecision`, `OperationRun`, `CallResult` (in `types.ts`) | new types | Roster + operator contracts; additive `hop.started`/`hop.ended` events |
| `src/knowledge/rosterKnowledgeBase.ts` | new | `Person[]`-backed KB: `getContext`, `getPerson(id)`, `listPeople()` |
| `src/operator/operator.ts` | new | `interface Operator { decideNext(input): Promise<OperatorDecision> }` |
| `src/operator/claudeOperator.ts` | new | The persistent `claude -p --resume` session |
| `src/operator/scriptedOperator.ts` | new | Canned decisions for offline CI |
| `src/claude/runClaude.ts` | extend (additive) | Add a session-capable call returning `{ result, sessionId }` and accepting `resume?` |
| `src/orchestrator/runOperation.ts` | new | The operator loop + per-operation persistence |
| `src/orchestrator/runScenario.ts` | small branch | If scenario has `roster` + `goal` → `runOperation`; else existing single-call path |
| `data/scenarios/scenario-b.json` | new | Multi-hop scenario: roster + engagement goal (no hard-coded chain) |
| `src/cli/play.ts` | small | Handle an `OperationRun` (print per-hop) as well as a `SavedRun` |
| `tests/rosterKnowledgeBase.test.ts`, `tests/runOperation.test.ts`, `tests/scriptedOperator.test.ts` | new | Offline, scripted, CI-gating |

### Contracts (the seams that stay fixed)

```ts
// PUBLIC profile the attacker side sees. NO secret here.
interface Person {
  id: string;
  name: string;
  title: string;
  phone: string;
  department?: string;
  publicInfo?: string;      // free text (LinkedIn-style); grounds the talker's pretext
}

// Roster KB. getContext() keeps the base KB contract so the talker is grounded per call.
interface RosterKnowledgeBase extends KnowledgeBase {
  getPerson(id: string): Promise<Person | undefined>;
  listPeople(): Promise<Person[]>;
}

// What the operator is handed each turn: the result of the call it just ordered
// (undefined on the very first turn).
interface CallResult {
  personId: string;
  transcript: Transcript;
  leaked: boolean;          // did the target speak the objective secret?
}

type OperatorDecision = {
  important: string;        // what to remember from the last call ('' on first turn)
  action:
    | { type: 'call'; personId: string; persona: string;
        objective: { id: string; description: string }; tactics: Tactic[] }
    | { type: 'stop'; reason: string };
};

interface Operator {
  decideNext(input: { last?: CallResult }): Promise<OperatorDecision>;
}
```

### The mock Target in a roster world

The Target stays a **mock-only fixture** (base design §3). In `scenario-b` each roster
person carries two simulation-only fields the **attacker never sees**:

- `secret` — the value this person guards (what a call against them tries to extract).
- `targetPersona` — how this person behaves on a call (stress, instincts, blind spots).

`runOperation` reads these from the scenario (not from `RosterKnowledgeBase.getPerson`,
which returns only the public profile) to build the `ClaudeTarget` and to set
`objective.secret` for the existing `SecretLeakExtractor`. The operator decides only the
objective *description*; it never knows the literal secret — it is trying to extract it.

## 4. Persistence layout

```
data/runs/<operationId>/
  operation.json     # summary: goal, people called, per-hop outcome, compromised flag, keyInfo
  memory.md          # the operator's distilled "important info", appended after each call
  calls/
    hop-1-<personId>.json   # { hopId, personId, persona, objective, transcript, endedReason, leaked }
    hop-2-<personId>.json
```

`operation.json` exposes flattened `keyInfo: Fact[]` and `compromised: boolean` so the
existing web `done` handler and `play.ts` keep working with **no changes** — a chained
operation just streams multiple calls into the same feed and reports a combined verdict.

## 5. Data flow (per operation)

1. `runScenario` sees `roster` + `goal` → builds `RosterKnowledgeBase`, a `ClaudeOperator`
   (or `ScriptedOperator` in tests), and calls `runOperation`.
2. `runOperation` loops (cap `MAX_HOPS`, e.g. 5):
   a. `operator.decideNext({ last })` → `{ important, action }`.
   b. Append `important` (if non-empty) to `memory.md`.
   c. `stop` → break. `call` → look up the person.
   d. Emit `hop.started`; run **one** call via `runCampaign` with a **fresh** `ClaudeAgent`
      built from `action.persona/objective/tactics`, against a `ClaudeTarget` built from the
      person's fixture `targetPersona` + `secret`; emit existing `call.*`/`*.turn` events.
   e. Save the transcript to `calls/`; set `last = { personId, transcript, leaked }`;
      emit `hop.ended`.
3. Save `operation.json`; return an `OperationRun`.

## 6. Testing

Same two-path strategy as the base design.

- **Offline CI (gating):** a `ScriptedOperator` returns a fixed decision sequence
  (call A → call B → stop), talker + target are `Scripted*`. `runOperation` runs the full
  loop with **no network/LLM**: assert the operator is driven correctly, transcripts land
  in `calls/`, `memory.md` accumulates the operator's `important` strings, the right
  `hop.*`/`call.*` events fire in order, and `operation.json` reports the combined verdict.
  `rosterKnowledgeBase.test.ts` covers `getPerson`/`listPeople`/`getContext` and the
  public/fixture split (no `secret` leaks through `getPerson`).
- **Live "play" (manual, subscription):** `npm run play data/scenarios/scenario-b.json`
  runs the real `ClaudeOperator` driving real Claude calls. Not in CI.

`runClaude`'s new session-capable variant is exercised only by the live path; the scripted
operator needs no Claude, so CI stays fast and offline.

## 7. Scope

**In:** roster KB, the operator agent (Claude + scripted), `runOperation`, per-operation
persistence (`calls/` + `memory.md`), `scenario-b`, CLI handling, tests.

**Out (roadmap, unchanged from base design):** real MCP/tool-use for the operator
(structured-decision loop is enough now), LLM-driven *target discovery* beyond the given
roster, relationship graphs, a smarter extractor, dashboard styling for hop separators
(the `hop.*` events are emitted, but the web UI styling for them is deferred — chained
calls already render as a continuous feed).

## 8. Open items

- `MAX_HOPS` default and per-call max-turns interplay (start at 5 hops × existing 20 turns).
- Exact operator system prompt (engagement framing, decision JSON schema, the
  authorized-simulation guardrail) — drafted during implementation.
- Whether `memory.md` is also re-fed to the operator on resume as a safety net, or we fully
  trust the session. Default: trust the session; `memory.md` is the durable artifact.
