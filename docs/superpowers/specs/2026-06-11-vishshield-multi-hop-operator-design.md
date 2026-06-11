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
2. **An Operator Agent** — *one logical agent* (a fresh `claude -p` call per turn, carrying
   its own distilled notes as memory) that runs the whole
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
operator's **accumulated distilled notes are the memory** — re-fed into a fresh
`claude -p` call each turn (we do not depend on CLI `--resume`; see §2). `memory.md` is the
durable, inspectable record of those notes, written when the operator says what mattered.

## 2. Architecture

```
┌─ OPERATOR AGENT  (fresh `claude -p` per turn; memory = its distilled notes) ─┐
│  given: goal + roster + running notes + last transcript                      │
│  each turn: distill what mattered from the last call, then choose:           │
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

### Why a fresh `claude -p` per decision (no `--resume`)

The operator is **one logical agent**, but we do **not** rely on the CLI's session
persistence (`--resume`) to carry its memory. We already persist the operator's memory
explicitly — full transcripts to `calls/` and the distilled "important" notes to
`memory.md` — so a resumed session would be a redundant, opaque second copy of state plus
a fragile dependency (session storage, `--no-session-persistence`, CLI-version quirks).

Instead, **each decision is a fresh `claude -p` call** (reusing the existing `runClaude`,
no new session plumbing). We feed it the engagement goal + the roster + the operator's
running distilled notes + the last call transcript; it returns the next distilled note and
the next action. The notes are the single, inspectable source of truth. This keeps the
operator on the Pro/Max subscription (no API key, no Agent SDK), forces it to distill what
matters (the behavior we want), and stays trivially testable with a scripted operator. Raw
transcripts remain on disk if we ever want to feed more than the latest one.

## 3. New / changed components

Everything is **additive** except a small, backward-compatible branch in `runScenario` and
two new fields on existing types. The single-call path (`scenario-a`, `runCampaign`,
`MockKnowledgeBase`, `ClaudeAgent`, all existing tests) is **unchanged**.

| Component | Kind | Responsibility |
|---|---|---|
| `Person`, `Operator`, `OperatorDecision`, `OperationRun`, `CallResult` (in `types.ts`) | new types | Roster + operator contracts; additive `hop.started`/`hop.ended` events |
| `src/knowledge/rosterKnowledgeBase.ts` | new | `Person[]`-backed KB: `getContext`, `getPerson(id)`, `listPeople()` |
| `src/operator/operator.ts` | new | `interface Operator { decideNext(input): Promise<OperatorDecision> }` |
| `src/operator/claudeOperator.ts` | new | A fresh `claude -p` per decision (reuses `runClaude`), carrying its running notes as memory; decision-parsing factored out for offline unit test |
| `src/operator/scriptedOperator.ts` | new | Canned decisions for offline CI |
| `src/orchestrator/runOperation.ts` | new | The operator loop + per-operation persistence |
| `src/orchestrator/runScenario.ts` | small branch | If scenario has `roster` + `goal` → `runOperation`; else existing single-call path |
| `data/scenarios/scenario-b.json` | new | Multi-hop scenario: roster + engagement goal (no hard-coded chain) |
| `src/cli/play.ts` | small | Handle an `OperationRun` (print per-hop) as well as a `SavedRun` |
| `tests/rosterKnowledgeBase.test.ts`, `tests/runOperation.test.ts`, `tests/scriptedOperator.test.ts`, `tests/claudeOperator.parse.test.ts` | new | Offline, scripted, CI-gating (see §6) |

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
// getContext(personId) PROJECTS the public profile into Fact[] (so runCampaign, which does
// `kb.getContext(targetId) → session.facts`, reuses unchanged). Projection is exactly:
//   name→{key:'name'}, title→{key:'title'}, phone→{key:'phone'},
//   department→{key:'department'} (if set), publicInfo→{key:'public_info'} (if set).
// It NEVER includes the fixture secret/targetPersona. Unknown id → [].
interface RosterKnowledgeBase extends KnowledgeBase {
  getContext(personId: string): Promise<Fact[]>;   // projection above
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

// runOperation is fully dependency-injected so the offline test swaps in scripted
// implementations and a temp runsDir — NOTHING live is constructed inside the loop.
interface RunOperationArgs {
  operationId: string;
  goal: string;
  roster: RosterKnowledgeBase;
  // sim-only fixtures keyed by personId; NEVER exposed to operator or talker:
  fixtures: Record<string, { secret?: string; targetPersona: string }>;
  operator: Operator;                                   // ScriptedOperator in tests
  makeAgent: (persona: string) => Agent;                // () => new ClaudeAgent() | ScriptedAgent([...])
  makeTarget: (personId: string, persona: string, secret?: string) => Target;
  makeCallEngine: (target: Target) => CallEngine;       // default: new MockCallEngine(target)
  conversationStore: ConversationStore;
  keyInfoStore: KeyInfoStore;
  extractor: KeyInfoExtractor;
  bus: EventBus;
  maxHops?: number;                                     // hard cap, default 5
  runsDir?: string;                                     // default 'data/runs'; test points at a tmp dir
}

// Structural superset of the three fields play.ts + web/server.ts read off a run,
// so both consumers keep working against `SavedRun | OperationRun`.
interface OperationRun {
  id: string;
  goal: string;
  hops: { hopId: number; personId: string; persona: string;
          objective: Objective; transcript: Transcript;
          endedReason: string; leaked: boolean }[];
  keyInfo: Fact[];          // flattened union across hops (read by play.ts + web)
  compromised: boolean;     // any hop leaked (read by web verdict)
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

`operation.json` exposes flattened `keyInfo: Fact[]` and `compromised: boolean`. Because
`OperationRun` is a structural superset of the fields the consumers actually read
(`web/server.ts` reads `run.compromised` + `run.keyInfo`; `play.ts` reads `run.keyInfo` +
`run.id`), the **web `done` handler needs no change** and a chained operation streams its
multiple calls into the same feed with a combined verdict. The **one small `play.ts`
edit**: its final log line currently prints `data/runs/${run.id}.json`; for an operation the
artifact is a *directory* (`data/runs/<id>/`), so that message must branch on the run shape.

**New events** (additive `ConversationEvent` variants): `hop.started` and `hop.ended`, each
carrying `{ operationId, hopId, personId }`. Existing visualizer/web switches ignore unknown
variants (no exhaustive `never` guard exists), so this is safe; per-hop UI styling is
deferred (§7).

## 5. Data flow (per operation)

1. `runScenario` discriminates on the scenario shape:
   `Array.isArray(scenario.roster) && typeof scenario.goal === 'string'` → operation path;
   else the existing single-call path (`scenario-a` has neither, so it is untouched). A
   scenario with `roster` but no `goal` (or vice-versa) is a **hard error**, never a silent
   fall-through. On the operation path it builds the `RosterKnowledgeBase` and `fixtures`
   map from the roster, a `ClaudeOperator`, and live factories
   (`makeAgent = () => new ClaudeAgent()`, `makeTarget = (_, persona, secret) =>
   new ClaudeTarget(persona, secret)`, `makeCallEngine = (t) => new MockCallEngine(t)`),
   then calls `runOperation`. Tests call `runOperation` directly with scripted args.

2. `runOperation` loops, `n = 1..maxHops` (default 5 — a **hard cap** that forces a stop
   with `reason: 'max_hops'` even if the operator never says stop). First turn passes
   `last: undefined` (never a fake empty `CallResult`):
   a. `decision = await operator.decideNext({ last })`. If the operator (Claude) returns
      unparseable/invalid output, treat it as `stop` with `reason: 'parse_error'` (see §6).
   b. If `decision.important` is non-empty, append `## hop N\n<important>\n` to `memory.md`.
   c. `action.type === 'stop'` → break. Otherwise look up `person = roster.getPerson(id)`;
      an unknown `personId` → record it and `stop` with `reason: 'unknown_person'`.
   d. **Merge the fixture secret** (operator never knows it):
      `objective = { ...action.objective, secret: fixtures[id]?.secret }`.
      Emit `hop.started`. Run **one** call via the existing `runCampaign`, all deps from
      `RunOperationArgs`:
      ```
      const target = makeTarget(id, fixtures[id].targetPersona, objective.secret);
      const { conversation, keyInfo } = await runCampaign({
        conversationId: `${operationId}-hop-${n}`, campaignId: operationId,
        targetId: id, objective, allowedTactics: action.tactics, persona: action.persona,
        agent: makeAgent(action.persona), callEngine: makeCallEngine(target),
        kb: roster, conversationStore, keyInfoStore, extractor, bus,
      });
      const leaked = keyInfo.length > 0;   // SecretLeakExtractor fired on objective.secret
      ```
      Existing `call.*`/`*.turn` events still emit from inside `runConversation`.
   e. Write the transcript to `<runsDir>/<op>/calls/hop-N-<id>.json`; append the hop to the
      run; set `last = { personId: id, transcript: conversation.transcript, leaked }`;
      emit `hop.ended`.
3. Write `<runsDir>/<op>/operation.json` (`mkdir … { recursive: true }`); return the
   `OperationRun` (with flattened `keyInfo` and `compromised = hops.some(h => h.leaked)`).

## 6. Testing

Same two-path strategy as the base design. **The multi-hop flow is fully covered offline**
because `runOperation` is dependency-injected (§3 `RunOperationArgs`) — the test passes a
`ScriptedOperator`, scripted agent/target factories, and a temp `runsDir`, so nothing live
is constructed. This is the user's explicit requirement.

**`tests/runOperation.test.ts` (gating, no network/LLM).** A `ScriptedOperator` yields
`call(A) → call(B) → stop`; the scripted target for A leaks its secret, for B does not.
Assert:
- `decideNext` called 3×; **hop 1 received `last === undefined`**; hop 2 received
  `last.personId === 'A'` with `last.leaked === true`.
- Transcript files exist at `<runsDir>/<op>/calls/hop-1-A.json` and `hop-2-B.json` with the
  expected turns and per-hop `leaked` flag.
- `<runsDir>/<op>/memory.md` contains the two non-empty `important` strings in order under
  `## hop N` headers, and **nothing for the first turn** (its `important` is `''`).
- Events fire in order: `hop.started(A)`, `call.started`, `agent.turn`/`target.turn`…,
  `call.ended`, `hop.ended(A)`, then the same block for B. No `hop.*` for the final `stop`.
- `operation.json`: `compromised === true` (A leaked), `keyInfo` is the flattened union, and
  the people-called order is `['A','B']`.
- A second case: `ScriptedOperator` that never stops → loop halts at `maxHops` with the last
  recorded reason `max_hops`.

**`tests/scriptedOperator.test.ts`** — the scripted operator returns its canned sequence and
ignores `last` deterministically.

**`tests/rosterKnowledgeBase.test.ts`** — `getPerson`/`listPeople` return public profiles;
`getContext(id)` returns the exact `Fact[]` projection (§3); **no `secret`/`targetPersona`
leaks through any method**; unknown id → `undefined`/`[]`.

**`tests/claudeOperator.parse.test.ts` (offline, no network).** Factor the decision parser
out of the live call so it is unit-testable against fixed strings: valid JSON → decision;
non-JSON / unknown `action.type` → a safe `stop('parse_error')`. (The `ClaudeOperator`'s
actual `claude -p` call is exercised only by the live play run.)

**Live "play" (manual, subscription):** `npm run play data/scenarios/scenario-b.json` runs
the real `ClaudeOperator` driving real Claude calls. Not in CI.

The live `ClaudeOperator` (a real `claude -p` per turn) runs only on the play path;
everything in CI is scripted, so the suite stays fast and offline.

## 7. Scope

**In:** roster KB, the operator agent (Claude + scripted), `runOperation`, per-operation
persistence (`calls/` + `memory.md`), `scenario-b`, CLI handling, tests.

**Out (roadmap, unchanged from base design):** real MCP/tool-use for the operator
(structured-decision loop is enough now), LLM-driven *target discovery* beyond the given
roster, relationship graphs, a smarter extractor, dashboard styling for hop separators
(the `hop.*` events are emitted, but the web UI styling for them is deferred — chained
calls already render as a continuous feed).

## 8. Resolved decisions & remaining open items

**Resolved (post-review):**
- `maxHops` default **5**, enforced as a hard cap (forces `stop: 'max_hops'`); per-call turns
  stay at the existing 20.
- Malformed/invalid operator output → safe `stop: 'parse_error'`; unknown `personId` →
  `stop: 'unknown_person'`. Decision-parsing is factored out for offline unit testing.
- `memory.md` format: `## hop N\n<important>\n`, appended only when `important` is non-empty.
- `OperationRun` is a structural superset of the consumer-read fields; `play.ts` gets one
  small log-line branch (artifact is a directory, not a `.json`).
- Memory model: the operator keeps its distilled notes and re-feeds them (plus the latest
  transcript) into a **fresh `claude -p` each turn — no `--resume`**. `memory.md` is the
  source of truth and the durable artifact.

**Remaining (drafted during implementation):**
- Exact operator system prompt — engagement framing, the strict decision-JSON schema the
  parser expects, and the authorized-simulation guardrail.
- `scenario-b` content: the roster (public profiles) + per-person fixtures
  (`secret`, `targetPersona`) + the engagement `goal`.
