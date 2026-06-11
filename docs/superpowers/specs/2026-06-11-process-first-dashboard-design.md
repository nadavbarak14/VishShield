# VishShield — Process-First Dashboard, Parallel Calls, Demo Mode

**Design doc · 2026-06-11**

Builds on `2026-06-11-vishshield-multi-hop-operator-design.md`.

## 1. What changes and why

Today the dashboard is a chat feed: call transcripts dominate, and the operator's
decisions are interstitial blocks between them. The user wants the inverse:

> It should look more of a **process**, not only show calls. You should see the main
> orchestrator's thinking; a call is just something it can use. The main agent is the
> operator, not the voice agent. It can potentially make multiple calls at the same
> time. We should see the calls list, the transcription, and the important memory saved.

Three deliverables:

1. **Parallel calls.** One operator decision may place several calls at once; they run
   concurrently and the operator receives all their results together.
2. **A scripted demo scenario.** Mocked operator decisions + mocked call transcripts,
   paced with small delays, so the dashboard can demo the full process (including a
   parallel wave and a leak) instantly with no LLM.
3. **A process-first dashboard.** Three panes:
   - **Agent process** (hero, left): one step card per operator decision — what it
     distilled (saved to memory), then its action rendered as tool-use rows
     (`PLACE CALL → …` chips with live status, `RECALL`, `STOP`). Calls never inline
     their transcript here.
   - **Transcript pane** (center): the selected call's live conversation bubbles.
     Auto-follows the newest call unless the user pins one from the list/chips.
   - **Sidebar** (right): the **calls list** (status + leak badge per call, click to
     view transcript) and the **memory panel** (every `important` note, live).

## 2. Decision shape: a wave of calls

`OperatorDecision`'s call action becomes a list (a "wave"):

```ts
interface CallOrder {
  personId: string; persona: string;
  objective: { id: string; description: string };
  tactics: Tactic[];
}
type action =
  | { type: 'call'; calls: CallOrder[] }      // 1..3 calls, run concurrently
  | { type: 'stop'; reason: string }
  | { type: 'recall'; hopId: number };
```

- `parseOperatorDecision` accepts the new `calls` array **and** the legacy flat
  single-call shape (normalized to a one-element wave); waves are capped at 3.
- `CallResult` gains `hopId`; `OperatorInput.last` becomes `CallResult[]` (all results
  of the last wave, ordered by hopId).
- `ClaudeOperator`'s prompt documents the array shape and that up to 3 parallel calls
  are allowed when useful.

## 3. runOperation: waves

The loop becomes `while (completed < maxHops)`:

1. Decision → emit (unchanged); recalls unchanged.
2. A call wave is trimmed to the remaining hop budget. All personIds are validated
   up-front; any unknown one → memory note + stop (no hop.started emitted).
3. Hop ids are assigned `completed+1 …` in array order; `hop.started` emits for each,
   then all calls run via `Promise.all` over the existing `runCampaign`. Their
   `call.*`/`*.turn` events interleave on the bus (each carries its conversationId,
   `<op>-hop-<n>`, which the UI uses for routing). `hop.ended` emits per call as it
   finishes. An empty wave is treated as a stop.
4. Hop files, the hops array, and `last` are recorded in hopId order.

`makeAgent` gains an optional second arg `personId` (needed by the demo factories).
memory.md format is unchanged.

## 4. Demo mode

`scenario-demo.json` has `"demo": true` plus the usual roster/goal, and a `script`:

```jsonc
{
  "demo": true, "paceMs": 700,
  "goal": "...", "roster": [ ... ],
  "script": {
    "decisions": [ /* OperatorDecision[] — incl. one parallel wave */ ],
    "calls": { "<personId>": [ { "transcript": [{"speaker","text"}, ...] } ] }
  }
}
```

`src/orchestrator/demoScenario.ts` exports `buildDemoRunArgs(scenario, bus, …)`:

- `ScriptedOperator` over `script.decisions`, wrapped with a thinking delay (~2×pace).
- Call scripts are consumed one queue entry per call in placement order; per call the
  transcript is split into agent lines / target lines for `ScriptedAgent`/`ScriptedTarget`
  wrappers that sleep `paceMs` per turn.
- End rule derived from the script: last turn by the agent → `agent_ended`; last turn
  by the target → the hang-up token is appended (`target_hung_up`).
- Leaks happen naturally: a scripted target line containing the fixture secret trips
  the existing `SecretLeakExtractor`.

`runScenario` branches on `scenario.demo === true` inside the operation path; the
Claude path is untouched. `paceMs: 0` makes the demo fully testable offline.

## 5. Dashboard (server.ts PAGE rewrite)

Server API (`/api/launch|runs|stream|scenarios`), the event log, and replay semantics
are unchanged — the new UI is pure event-driven rendering, so live and replay render
identically. Client state is keyed by call (hopId parsed from the conversationId
suffix; a synthetic call is created for hop-less single-call scenarios):

- `operator.decision` → process step card (+ memory panel append when `important`).
  Call actions render one pending chip per order; chips bind to their call when the
  matching `hop.started` (same personId, FIFO) arrives.
- `hop.started` → call record + list row + (if not pinned) transcript selection.
- `agent.turn` / `target.turn` → routed to that call's buffer; rendered when selected.
- `call.ended` → end marker; `hop.ended` → leak badge everywhere.
- `done` → verdict card + key-info chips at the bottom of the process column.

## 6. Testing

- `parseDecision.test`: calls-array shape, legacy normalization, wave cap, invalid entries.
- `runOperation.test`: updated shapes; new parallel test — one decision with 2 calls
  asserts both `hop.started` precede any `hop.ended`, hop files 1+2 exist, and the next
  `decideNext` receives both results ordered by hopId.
- `demoScenario.test`: offline (`paceMs: 0`) full run through `runOperation` in a tmp
  dir — parallel wave events, memory notes, leak verdict.
- `terminalVisualizer.test`: decision line covers a multi-call wave.
- Existing single-call path tests stay green unchanged.

## 7. Out of scope

Real telephony, persisting demo runs differently, mobile layout polish, operator-side
streaming "thinking tokens" (the decision event is the thinking granularity for now).
