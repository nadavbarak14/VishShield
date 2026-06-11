# VishShield — Tactics-First Sessions

**Design doc · 2026-06-11**

Builds on `2026-06-11-process-first-dashboard-design.md` and
`2026-06-11-vishshield-multi-hop-operator-design.md`.

## 1. What changes and why

Today you start a run by **deploying a scenario**: a single JSON file
(`data/scenarios/*.json`) bundles the org roster, the engagement goal, each
person's secret, a sanctioned-tactics list, `maxHops`, and an attacker persona.
The user wants to invert this:

> I want the "scenario" to be **tactics**. I don't want a constant amount of hops
> or any constants. The agent is free to act and choose what to do next. The
> default baseline to start a new session is a window where you can choose tactics
> and also see the workers map. You don't deploy a scenario, you just select
> tactics. Then you see the employees map, you can choose if someone is a specific
> target and mark them as preferred. Then you start the session. The agent has free
> autonomy to use the skill of calling people to get its desired outcome — which can
> differ in tactics and targeted people. The agent should be a smart ReAct one.

Clarified in brainstorming:

- **A tactic IS the instructions** for how to get info. There can be several, and
  you select one or more. There is **no separate goal field** — the goal lives
  inside the tactic instructions.
- **Hops:** keep a **hardcoded 5-call cap for now** (test value), not a UI control.
- **Org:** one persistent dataset (`data/org.json`) — the "workers map." No in-app
  org picker.
- **Preferred target:** a **soft bias** ("start here if sensible; you may call
  anyone"), optional, none by default.

The key realization: the operator (`AiOperator` / `ClaudeOperator` driving
`runOperation`) is **already** a smart ReAct loop. Each turn it freely chooses who
to call, the persona, the per-call objective, the persuasion techniques, may recall
past transcripts, and stops on a leak. So this work is **not** a rewrite of the
agent. It is:

1. Splitting the old scenario bundle into two independent inputs you combine at
   session start — **the org** (fixed) and **tactics** (selected).
2. A new **session-start window** (tactics multi-select + workers map with
   preferred-target marking) replacing the scenario-library "deploy" overlay.
3. A naming cleanup so the word "tactic" means the new selectable unit.

## 2. Concept model

| Old | New |
| --- | --- |
| Scenario file bundles roster + goal + secrets + tactics + maxHops + persona | **Org** (`data/org.json`): roster + per-person secret. **Tactics** (`data/tactics/*.json`): instruction blueprints you select. |
| "Deploy a scenario" | "Select tactics, mark a preferred target (optional), start session" |
| `goal: string` from the file | Goal synthesized from the selected tactics' instructions |
| `maxHops` per file | Hardcoded `MAX_SESSION_CALLS = 5` |
| `Tactic` type = persuasion primitives (`pretext`, `authority`…) | Renamed to **`Technique`**. The word **`Tactic`** now means a session-level instruction blueprint. |

A **session** is one run of the operator loop over the org, guided by the selected
tactics, optionally biased toward a preferred entry point, capped at 5 calls,
stopping as soon as any call leaks a secret.

## 3. Naming: `Tactic` → `Technique`

The existing `Tactic` union (`src/types.ts:1`) is the low-level persuasion
primitive the operator emits per call. It is renamed to `Technique` to free the
word "tactic" for the user's concept. This is a mechanical rename across:

- `src/types.ts` — `Tactic` union → `Technique`; `CallOrder.tactics: Tactic[]` →
  `techniques: Technique[]`; `AgentSession.allowedTactics` → `allowedTechniques`.
- `src/operator/operatorPrompt.ts` — the JSON action shape's `"tactics":[…]` field
  → `"techniques":[…]`; prose mentions of "tactics" for the primitives → "techniques."
- `src/operator/parseDecision.ts` — accept the renamed field.
- `src/web/server.ts` — `ALL_TACTICS` → `ALL_TECHNIQUES`; the left-panel
  "SANCTIONED TACTICS" chips relabel to "TECHNIQUES"; `c.tactics` / `order.tactics`
  reads in `derive()` → `techniques`.
- Any test fixtures / scenario JSON using `tactics` / `allowedTactics` for the
  primitive list.

The persuasion primitives keep their values (`pretext`, `authority`, `urgency`,
`social_proof`, `foot_in_the_door`, `borrowed_legitimacy`, `rapport`). Only the
type name and the per-call field name change.

> Back-compat: `parseDecision` accepts BOTH `techniques` and a legacy `tactics`
> field on a `call` action (reads `techniques ?? tactics`) so older operator
> outputs / fixtures don't break mid-rename.

## 4. Data shapes

### 4.1 `data/org.json` (the workers map)

One organization. Carries the roster (public info the attacker side sees) **and**
the secret per person (sim-only; never exposed to operator or caller).

```jsonc
{
  "id": "meridian",
  "name": "Meridian Software",
  "people": [
    {
      "id": "dana",
      "name": "Dana Reyes",
      "title": "IT Helpdesk Specialist",
      "phone": "+972558835915",
      "department": "IT",
      "publicInfo": "Front line for INC tickets; posts in #it-help.",
      "secret": null,                       // no secret to leak; an intermediary
      "targetPersona": "Friendly, fast, eager to close tickets.",
      "hint": "If you need anything deploy-related, talk to Sam in SRE."
    },
    {
      "id": "sam",
      "name": "Sam Okafor",
      "title": "Senior Site Reliability Engineer",
      "phone": "+972558835915",
      "department": "Engineering",
      "publicInfo": "Payments-service on-call; speaks at SRE meetups.",
      "secret": "MRD-PROD-DEPLOY-7Q4X9",
      "targetPersona": "Competent but stretched thin when covering on-call alone."
    }
  ]
}
```

Seeded from the existing `scenario-demo.json` / `scenario-b.json` rosters so there
is real data on day one. `secret`, `targetPersona`, and `hint` are sim-only
fixtures; `id/name/title/phone/department/publicInfo` form the `Person` the
operator sees.

### 4.2 `data/tactics/*.json` (instruction blueprints)

Each file is one selectable tactic. Self-contained: the "how to get info" that also
implies the "what."

```jsonc
{
  "id": "it-mfa-reset",
  "name": "IT MFA reset",
  "summary": "Pose as IT running an MFA migration; get a one-time code read back.",
  "instructions": "Call as the internal IT service desk performing a mandatory MFA re-enrollment tonight. Build rapport, cite an official-sounding ticket, and get the employee to read back the one-time enrollment code or deploy token they can see. Escalate through whoever knows who holds the real secret."
}
```

`summary` shows on the tactic chip; `instructions` is what the operator reads.
Ship 2–3 seed tactics derived from the existing scenarios (e.g. `it-mfa-reset`,
`incident-escalation`, `exec-urgency`).

## 5. Orchestration: `runSession`

New entry point in `src/orchestrator/runSession.ts`. `runScenario` stays untouched
for back-compat with old files and existing tests.

```ts
export interface SessionConfig {
  tacticIds: string[];          // ≥1; selected tactic blueprint ids
  preferredTargetId?: string;   // optional soft bias
}

export async function runSession(cfg: SessionConfig, bus: EventBus): Promise<OperationRun>;
```

Steps:

1. Load `data/org.json` → `Person[]` roster (strip secrets) + `fixtures`
   (`{ [personId]: { secret?, targetPersona } }`) + a `mockMap` for mock calls,
   exactly as `runOperationScenario` builds them today.
2. Load each selected tactic from `data/tactics/<id>.json`; collect their
   `instructions`.
3. Build the **operator guidance** (see §6) and resolve the preferred-target name
   from the roster.
4. Pick operator backend (`VISH_OPERATOR_BACKEND`) and call backend
   (`VISH_CALL_BACKEND`) using the **same** logic as `runOperationScenario`
   (the Dial dry-run branch is copied verbatim).
5. Call `runOperation({ … operator, conductor, makeAgent, makeTarget, fixtures,
   roster, maxHops: MAX_SESSION_CALLS, stopOnGoal: true, … })`.

`MAX_SESSION_CALLS = 5` is a single exported constant in
`src/orchestrator/runSession.ts` (the one knob to revisit when we later remove the
cap). `operationId = "session-" + Date.now()`. Runs persist to `data/runs/<id>/`
unchanged.

`OperationRun` (`src/types.ts`) gains two **optional** fields so a live or reopened
session can show what it was started with: `tactics?: { id: string; name: string }[]`
and `preferredTargetId?: string`. `runSession` populates both; `runOperation` is
extended to copy them through from its args (defaulting to undefined, so
`runScenario`/operation runs are unaffected). The left TACTICS panel and the
inspector read these.

### 5.1 Operator construction

`AiOperator` / `ClaudeOperator` are constructed today as `new AiOperator(goal,
roster)`. Their constructor signature is unchanged; `goal` now receives the
**synthesized guidance string** from §6 instead of a scenario's `goal`. The
preferred-target hint is appended into that same guidance string, so no operator
constructor or `decideNext` signature changes are required.

## 6. Operator guidance (replaces single goal line)

`operatorPrompt.ts` currently emits `Engagement goal: <goal>`. With tactics there
is no single goal, so `buildOperatorPrompt` receives a richer guidance block. The
simplest change that touches nothing downstream: **keep the `goal: string`
parameter but fill it with a composed string**, assembled by `runSession`:

```
Your objective is to extract any sensitive secret from the organization by phone,
using the authorized tactics below. Choose freely which tactic(s) to apply on each
call, and switch between them as the situation warrants.

TACTICS (authorized approaches — mix and adapt as needed):
1. IT MFA reset — <instructions…>
2. Incident escalation — <instructions…>

Preferred entry point: Sam Okafor (Senior SRE). Start there if it makes sense, but
you are free to call anyone on the roster to reach the objective.
```

The `Preferred entry point:` line is omitted when no target is marked. The system
prompt (`SYSTEM` in `operatorPrompt.ts`) keeps its "stop as soon as the goal is
met / leak detected = achieved" instruction unchanged — a leak still ends the
session. The only edit to `operatorPrompt.ts` itself is the `Tactic`→`Technique`
field rename in the JSON shape (§3); the "Engagement goal:" label may stay or be
softened to "Engagement guidance:".

## 7. Web UI: the new-session window

`src/web/server.ts` is one big HTML/JS string. Changes are scoped to the
session-start surface; the center spine (decisions → call side-quests → verdict),
worker tree, exfil panel, inspector, and SSE/event model are untouched.

### 7.1 Replace the scenario library overlay with a NEW SESSION window

- The `+ NEW SESSION` button and the empty-state `OPEN SCENARIO LIBRARY` button
  open a new overlay (`overlay = 'session'`) instead of `'library'`.
- The window has two regions:
  - **TACTICS** — chips/cards from `GET /api/tactics`, multi-select (toggle
    `selectedTactics: Set`). Hover/expand shows `summary`. `START SESSION` is
    disabled until ≥1 is selected.
  - **WORKERS MAP** — reuse the existing map overlay rendering of the org. Clicking
    a worker toggles them as the **preferred target** (`preferredTargetId`); a ★
    badge marks the choice. Optional; at most one.
- `START SESSION` → `POST /api/session { tacticIds, preferredTargetId }`, then the
  client opens the returned run and streams it via the existing SSE path.

### 7.2 Left "SCENARIO" panel → "TACTICS"

The left accordion's `SCENARIO` panel becomes `TACTICS`: it lists the selected
tactics for the live/loaded session (names from `OperationRun.tactics`, §5) and
keeps the OPERATION LOG (past runs) list. The persuasion-primitive chips currently
under "SANCTIONED TACTICS" relabel to "TECHNIQUES" (they reflect what the operator
emitted per call; they remain display-only).

### 7.3 Header / status copy

- The empty-state center copy changes from "deploy a scenario to start a new
  session" to "select tactics and a target to start a new session."
- `HOPS n/—` continues to read the run's hop count over the cap; the cap is the
  shared `MAX_SESSION_CALLS`.

### 7.4 New/changed HTTP endpoints

| Method | Path | Body / returns |
| --- | --- | --- |
| `GET` | `/api/org` | the public workers map (roster, **no secrets**) |
| `GET` | `/api/tactics` | `[{ id, name, summary }]` (no full instructions needed client-side) |
| `POST` | `/api/session` | body `{ tacticIds: string[], preferredTargetId?: string }` → `{ runId }`; kicks off `runSession` against a fresh `EventBus`, same pattern as today's deploy |

The existing `GET /api/scenarios`, `/api/runs`, `/api/runs/:id`, and the SSE stream
stay. `/api/scenarios` may remain for reopening historical runs but is no longer
the primary start path.

## 8. Security & safety posture (unchanged)

- Calls remain **simulated by default** (`VISH_CALL_BACKEND=simulated`); the Dial
  backend stays **dry-run by default**. `runSession` copies the existing guardrails
  verbatim — no new path makes a real call easier to trigger.
- Secrets in `org.json` are sim-only fixtures, never sent to the operator or caller
  agent (same boundary as today's `fixtures`).
- The 5-call cap is a hard backstop in `runOperation` via `maxHops`.
- This is authorized-engagement tooling; the operator system prompt's
  "AUTHORIZED, CONSENTED security-awareness engagement" framing is retained.

## 9. Out of scope (YAGNI)

- No in-app org picker (one `org.json`).
- No in-app tactic editor (tactics are authored as JSON files).
- No per-session call-budget control (cap stays hardcoded at 5).
- No removal of the call cap (deferred; it's a single constant when we want it).
- No change to the operator's ReAct loop, decision shape, recall, parallel waves,
  or the conductor/agent/target layers.

## 10. Testing

- **Unit:** `runSession` loads `org.json` + tactics, builds correct `fixtures`
  (secrets present, stripped from the operator's `Person[]`), composes the guidance
  string (with and without a preferred target), and passes `maxHops = 5`.
- **Unit:** `parseDecision` accepts both `techniques` and legacy `tactics`.
- **Rename safety:** existing `runScenario` / operation tests still pass after the
  `Tactic`→`Technique` rename.
- **Endpoint:** `POST /api/session` with 0 tactics is rejected; with ≥1 returns a
  `runId` and the SSE stream emits the standard `operator.decision` / `hop.*`
  sequence.
- **Manual:** open the dashboard, NEW SESSION, select two tactics, mark a preferred
  target, START, watch the process spine drive a multi-call session that stops on a
  leak or at 5 calls.
