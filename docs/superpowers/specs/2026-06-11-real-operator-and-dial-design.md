# Real operator (Vercel AI SDK) + getdial.ai call backend — design

Date: 2026-06-11

## Goal

Two changes, both behind existing interfaces so the deterministic test suite is untouched:

1. **Swap the operator's brain** from a `claude -p` subprocess to a real, model-agnostic
   agent built on the Vercel AI SDK. Default model **Gemini Flash** for now; any provider
   selectable by env for deploy. Claude (`ClaudeOperator`) and the scripted operator stay in
   the tree — Claude remains the brain for the mock/test path; nothing about CI changes.
2. **Add a real call backend** using [getdial.ai](https://getdial.ai): place an outbound AI
   voice call to a real person and read back the transcript, as an alternative to the
   simulated (Claude/mock role-player) calls.

Non-goals: deleting `ClaudeOperator`; changing the `Operator`/`Agent`/`Target`/`CallEngine`
interfaces; changing any scripted or mock test fixture; building inbound-call or SMS support.

## Background: the three brains today

- **Operator** — the strategist. `Operator.decideNext(input): Promise<OperatorDecision>`
  (`src/operator/operator.ts`). `ClaudeOperator` (`src/operator/claudeOperator.ts`) builds a
  prompt, calls `runClaude(SYSTEM, prompt, OPERATOR_MODEL)` (a `claude -p` subprocess in
  `src/claude/runClaude.ts`), and runs the JSON text through `parseOperatorDecision`
  (`src/operator/parseDecision.ts`). `ScriptedOperator` returns canned decisions for tests.
- **Agent / Target** — the caller and victim role-players. They drive a turn-by-turn
  conversation through `CallEngine.say(text)` (`src/callEngine/callEngine.ts`), looped by
  `runConversation` (`src/orchestrator/runConversation.ts`). Implementations: `ClaudeAgent`/
  `ClaudeTarget` (live), `MockVoiceAgent`/`MockVoiceTarget` (deterministic), scripted.
- **Orchestration** — `runOperation` (`src/orchestrator/runOperation.ts`) asks the operator
  for a wave of `CallOrder`s, then for each hop builds an agent + target + call engine inline
  and calls `runCampaign` → `runConversation`, collecting transcripts + leak verdicts back to
  the operator. `runScenario` (`src/orchestrator/runScenario.ts`) wires the concrete
  implementations from a scenario file.

## The Dial mismatch (why Dial is not a `CallEngine`)

Dial is **autonomous**, not turn-based. The integration shape (from the Dial REST docs):

- `POST https://getdial.ai/api/v1/calls` with body `{ to, fromNumberId, outboundInstruction,
  language? }` and header `Authorization: Bearer sk_live_...`. Returns `{ call: { id, status,
  ... } }`; `status` starts at `initiated`.
- Dial's own AI voice agent then holds the **entire** conversation with a **real human** from
  that single `outboundInstruction` system prompt. There is no per-turn driving from our side.
- `GET https://getdial.ai/api/v1/calls/{id}` returns the `Call` including `status`,
  `duration`, and `transcript` (a single string, `null` until the call ends).

So Dial cannot sit behind `CallEngine.say(text)` (which is "deliver one line, get one reply"):
there is no line-by-line exchange to drive, and the victim is a real person, not a role-player.
Dial replaces the **whole per-call conduct step**, one level above `CallEngine`.

## Part 1 — Operator on the Vercel AI SDK

### New: `src/ai/model.ts`

A small factory that resolves env → a Vercel AI SDK `LanguageModel`:

- `VISH_OPERATOR_PROVIDER` — `google` (default) | `anthropic` | `openai`.
- `VISH_AI_OPERATOR_MODEL` — model id; default `gemini-2.5-flash` when provider is `google`.
  **Note:** this is a NEW var, deliberately distinct from the existing `VISH_OPERATOR_MODEL`,
  which `runClaude.ts:11` already uses to pick the `claude --model` for the subprocess
  operator (default `sonnet`). Reusing that var would feed a Gemini id to `claude --model`
  (or a Claude id to the AI SDK) depending on backend. Keep them separate.
- Maps provider → the matching `@ai-sdk/*` factory (`google(...)`, `anthropic(...)`,
  `openai(...)`). Unknown provider throws a clear error naming the accepted values.
- API keys come from each provider's standard env var (e.g.
  `GOOGLE_GENERATIVE_AI_API_KEY`); the factory does not read or require keys itself, so it
  can be unit-tested without network or secrets.

### New: `src/operator/aiOperator.ts` — `AiOperator implements Operator`

Mirrors `ClaudeOperator` exactly except for the model call:

- Same `SYSTEM` prompt and the same per-turn prompt assembly (roster / notes / history /
  last-wave rendering). To avoid duplicating that text, the shared prompt-building helpers
  (`renderRoster`, `renderTranscript`, `renderCallResults`, `renderHistory`, the `SYSTEM`
  constant, and the per-turn `parts` assembly) move into a new
  `src/operator/operatorPrompt.ts`; both `ClaudeOperator` and `AiOperator` import them. This
  is a targeted extraction, not a rewrite — the prompt text is unchanged.
- `decideNext` calls a `generate` function — by default a thin wrapper around
  `generateText({ model, system, prompt })` from the `ai` package — then
  `parseOperatorDecision(result.text)` (the **existing** parser, preserving the `parse_error`
  safe-stop and all its tests). Notes accumulate exactly as today.
- **Test seam:** the `ai` package's `generateText` takes a `LanguageModel`, not an injectable
  function, so "inject a fake model" is only clean via one of two routes. We commit to the
  constructor seam: `AiOperator`'s constructor accepts an optional
  `generate?: (args: { system: string; prompt: string }) => Promise<{ text: string }>`,
  defaulting to the real `generateText`-backed wrapper. Tests pass a stub returning canned
  JSON text — no model, no network. (The SDK's `MockLanguageModelV2` from `ai/test` is the
  alternative; we prefer the constructor seam because it also isolates the prompt assembly
  for golden tests.)

### Wiring: `src/orchestrator/runScenario.ts`

`runOperationScenario` chooses the operator backend by env, defaulting to the AI SDK:

- `VISH_OPERATOR_BACKEND` — `ai` (default) | `claude`.
- `ai` → `new AiOperator(goal, roster)`; `claude` → `new ClaudeOperator(goal, roster)`.

Scripted/unit tests construct operators directly and are unaffected.

### Dependencies

Add runtime deps: `ai`, `@ai-sdk/google` (default), plus `@ai-sdk/anthropic` and
`@ai-sdk/openai` so deploy can switch providers without a code change.

## Part 2 — getdial.ai call backend

### New: `src/dial/dialClient.ts`

Thin `fetch` wrapper over the two REST endpoints (no `@getdial/sdk` dependency):

- `makeCall({ to, fromNumberId, outboundInstruction, language? }): Promise<DialCall>` →
  `POST /api/v1/calls`. Unwraps the `{ call: Call }` response envelope and returns the inner
  `call`.
- `getCall(id): Promise<DialCall>` → `GET /api/v1/calls/{id}`, likewise unwrapping `{ call }`.
- `DialCall` = `{ id, status, duration, transcript, ... }` matching the documented `Call`
  schema (`transcript` is `string | null`, null until the call ends). Base URL
  `https://getdial.ai`, overridable by `DIAL_BASE_URL` (for tests).
- Auth header from `apiKey`. Non-2xx throws an error carrying the status + body snippet.
- The HTTP layer is injectable (a `fetch`-shaped function) so tests run against a stub with
  no network.

### New: `src/dial/dialConductor.ts` — the per-call seam

Introduce a `CallConductor` abstraction so `runOperation` is agnostic to *how* a call is
conducted. The signature must carry everything the simulated path needs — today's inline
block (`runOperation.ts:126-161`) depends on the per-hop `hopId`/`conversationId`
(`` `${operationId}-hop-${hopId}` ``), the `bus`, the three stores/extractor, the roster
(`kb`), the `campaignId`, the `makeAgent`/`makeTarget`/`makeCallEngine` factories, and the
per-person fixture (`secret`/`targetPersona`). So the conductor takes its stable collaborators
at construction and a per-call **context object** at `conduct` time, and it **owns extraction**
(today `runCampaign` runs the extractor and the stores; that stays inside the conductor):

```ts
interface ConductedCall {
  transcript: Turn[];
  endedReason: string;
  keyInfo: Fact[];        // leak verdict; runOperation reads keyInfo.length > 0 as `leaked`
}
interface ConductCtx {
  order: CallOrder;
  person: Person;
  objective: Objective;   // includes the fixture secret, as built in runOperation today
  hopId: number;
  conversationId: string; // `${operationId}-hop-${hopId}`, built by runOperation
  campaignId: string;     // = operationId
}
interface CallConductor {
  conduct(ctx: ConductCtx): Promise<ConductedCall>;
}
```

- `SimulatedConductor` — constructed with `{ makeAgent, makeTarget, makeCallEngine, kb,
  conversationStore, keyInfoStore, extractor, bus }`. `conduct(ctx)` runs today's block
  **verbatim**: it calls `makeAgent`/`makeTarget`/`makeCallEngine` then `runCampaign(...)`,
  returning `{ transcript, endedReason, keyInfo }` from the resulting conversation. Because
  `runCampaign` already calls `conversationStore.save`, `keyInfoStore.put`, and the extractor,
  moving the block wholesale keeps those side effects intact.
  - **Ordering guarantee (load-bearing):** `runOperation` still wraps the `conduct` calls in
    the same single `Promise.all(orders.map(...))` (lines 126-161), and `SimulatedConductor.
    conduct` performs the `makeAgent`/`makeTarget`/`makeCallEngine` factory calls
    **synchronously up to its first `await`**, preserving the determinism the comment at
    `runOperation.ts:122-125` relies on for scripted/demo fixtures.
- `DialConductor` — constructed with `{ client: DialClient, fromNumberId, extractor, bus,
  dryRun, pollMs, timeoutMs }`. `conduct(ctx)`:
  1. Build `outboundInstruction` from `ctx.order`: persona, objective description, allowed
     tactics, and the target's public facts. This is the caller persona's system prompt.
     **It never contains the secret.** (`ctx.objective.secret` is used ONLY by the extractor
     to score a leak, never placed into the instruction.)
  2. **Dry-run gate (default for the Dial backend):** when `dryRun` is true (i.e.
     `VISH_DIAL_DRY_RUN` is not explicitly `false`), do **not** dial — emit a distinct,
     visible marker rather than a silent dead call: return a one-turn transcript
     `[{ speaker: 'agent', text: '[DIAL DRY-RUN] would call <to> with: <outboundInstruction>' }]`,
     `endedReason: 'dial_dry_run'`, and `keyInfo: []`. The synthetic turn makes the dry run
     obvious in the operator's next `CallResult` (see S2 note below) instead of looking like a
     real call where nobody leaked.
  3. Live mode (`dryRun` false): `client.makeCall({ to: ctx.person.phone, fromNumberId,
     outboundInstruction, language? })`, then poll `client.getCall(id)` every `pollMs`
     (default 3000) up to `timeoutMs` (default 300000) until `status` is terminal. Parse the
     returned `transcript` string into `Turn[]` via `parseDialTranscript`, map status →
     `endedReason` (see status table below), and run `extractor.extract(transcript,
     ctx.objective)` for `keyInfo`. A poll that exceeds `timeoutMs` returns whatever transcript
     exists with `endedReason: 'dial_timeout'`.

### Dial status → outcome (unverified — pin against a real response before live)

The Dial docs are not publicly reachable to confirm the exact `status` strings, so these are
ASSUMPTIONS isolated in one mapping module (`dialStatus.ts`), to be corrected once a real POST
and a real GET response are captured:

- **Terminal:** `completed` / `ended` → `endedReason: 'completed'`; `failed` / `no-answer` /
  `busy` / `canceled` → `endedReason` = that status.
- **Non-terminal (keep polling):** `initiated` / `ringing` / `in-progress`, **and any unknown
  status** — treating unknown as non-terminal prevents a new status from being misread as
  "done." The `timeoutMs` is the backstop.

### Wiring: `runScenario`/`runOperation`

- `VISH_CALL_BACKEND` — `simulated` (default) | `dial`. `runOperationScenario` constructs the
  conductor (passing the collaborators it already builds today) and passes it to
  `runOperation`. `runOperation` gains a `conductor: CallConductor` arg; when omitted it
  defaults to a `SimulatedConductor` built from the existing `args`, so existing callers/tests
  need no change.
- `dial` requires `DIAL_API_KEY` and `DIAL_FROM_NUMBER_ID`; missing either is a clear startup
  error (not a silent fall-back to simulated). The dry-run default still applies, so even a
  fully configured Dial backend does not dial until `VISH_DIAL_DRY_RUN=false`.
- The leak verdict for BOTH paths now comes from `ConductedCall.keyInfo` (the conductor runs
  the extractor); `runOperation` keeps computing `leaked = keyInfo.length > 0` and the rest of
  its loop (events, hop JSON, `stopOnGoal`) is unchanged.

> **S2 — dry-run vs. the operator loop.** With dry-run on, every hop returns
> `leaked: false`, so `stopOnGoal` never trips and the operation runs to `maxHops`. That is
> acceptable *because* each dry-run `CallResult` now carries the explicit `[DIAL DRY-RUN]`
> synthetic turn (step 2), so the operator's rendered history shows the calls were no-ops, not
> failed real calls. Dry-run is for verifying wiring and the built instruction, not for
> exercising the operator's success path — that is what the simulated backend is for.

## Configuration summary

| Env var | Default | Meaning |
|---|---|---|
| `VISH_OPERATOR_BACKEND` | `ai` | Operator brain: `ai` (Vercel AI SDK) or `claude` (subprocess) |
| `VISH_OPERATOR_PROVIDER` | `google` | AI SDK provider when backend is `ai` |
| `VISH_AI_OPERATOR_MODEL` | `gemini-2.5-flash` | Model id for the AI SDK operator (distinct from `VISH_OPERATOR_MODEL`, which is the Claude-subprocess model) |
| `VISH_OPERATOR_MODEL` | `sonnet` | (existing) Claude-subprocess model; unchanged |
| `VISH_CALL_BACKEND` | `simulated` | Call conductor: `simulated` or `dial` |
| `VISH_DIAL_DRY_RUN` | `true` | When not `false`, Dial logs the call instead of dialing |
| `DIAL_API_KEY` | — | `sk_live_...` bearer key (required for live Dial) |
| `DIAL_FROM_NUMBER_ID` | — | Dial number id to call from (required for live Dial) |
| `DIAL_BASE_URL` | `https://getdial.ai` | Override for tests |
| `DIAL_POLL_MS` / `DIAL_TIMEOUT_MS` | `3000` / `300000` | Poll interval / overall timeout |

## Testing

All new tests are offline/deterministic; no live model or phone calls in CI.

- **`src/ai/model.ts`** — provider/model resolution: default is google + `gemini-2.5-flash`;
  `VISH_AI_OPERATOR_MODEL` / `VISH_OPERATOR_PROVIDER` overrides; unknown provider throws.
- **`AiOperator`** — construct with a stub `generate` (the constructor seam) returning canned
  JSON text; assert it produces the right `OperatorDecision` and accumulates notes. A garbage
  model output yields a `parse_error` stop (delegated to the existing parser). No `ai`-package
  model or network involved.
- **`operatorPrompt.ts`** — golden assertions that the extracted helpers render the same text
  the current `ClaudeOperator` produced (guards the refactor).
- **`dialClient.ts`** — against a stub `fetch`: correct method/url/headers/body for `makeCall`
  and `getCall`; non-2xx throws with a useful message.
- **`parseDialTranscript`** + **`dialStatus.ts`** — labelled transcript string → `Turn[]`;
  status mapping (terminal vs. non-terminal, unknown → non-terminal).
- **`DialConductor`** — dry-run returns `dial_dry_run` with the `[DIAL DRY-RUN]` synthetic turn
  and never calls the client; live mode (stubbed client) polls until terminal and returns the
  parsed transcript + `keyInfo`; timeout returns `dial_timeout`; the built `outboundInstruction`
  never contains the secret even when `ctx.objective.secret` is set.
- **`SimulatedConductor` / `runOperation`** — the existing `runOperation` tests must pass
  unchanged after the refactor (proof the extraction is behavior-preserving), including the
  parallel-wave ordering test.

## Risks / open questions

- **Dial schema is UNVERIFIED.** The Dial REST docs were not publicly reachable to confirm
  the call path (`/api/v1/calls`), the request fields (`to`, `fromNumberId`,
  `outboundInstruction`, `language`), the response envelope (POST appeared to return
  `{ call: {...} }`; GET likewise — `dialClient` must handle the envelope, not a bare `Call`),
  or the `status` enum. Worse, a documented example showed a non-null `transcript` on an
  `initiated` call, which is almost certainly a doc artifact, not real behavior. **Before
  enabling live mode, capture one real POST and one real GET and pin the schema + status set.**
  All field/path/status assumptions are isolated in `dialClient.ts` and `dialStatus.ts` so the
  correction is localized.
- **HTTP errors mid-poll.** `getCall` throws on non-2xx; a transient 5xx during polling would
  abort the hop. Decide at implementation time whether poll errors retry until `timeoutMs` or
  fail fast — the spec leans toward retry-until-timeout for robustness against blips.
- **Real calls to real people.** Dial dials humans. The dry-run-by-default gate and the
  required explicit `VISH_DIAL_DRY_RUN=false` are the guardrail. Use only for authorized,
  consented engagements.
- **Transcript shape.** Dial returns one `transcript` string; the example payloads suggest a
  speaker-labelled text. `parseDialTranscript` is best-effort and isolated so it is easy to
  adjust once a real transcript is observed; if labels are absent it falls back to a single
  agent-attributed turn rather than crashing.
- **Gemini Flash and the strict JSON contract.** We keep `generateText` + the lenient
  `parseOperatorDecision` (which extracts the first JSON object and safe-stops on failure),
  so occasional prose wrapping degrades to a stop rather than a crash.
