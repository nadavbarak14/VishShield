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
- `VISH_OPERATOR_MODEL` — model id; default `gemini-2.5-flash` when provider is `google`.
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
- `decideNext` calls `generateText({ model, system, prompt })` from the `ai` package, then
  `parseOperatorDecision(result.text)` — the **existing** parser, preserving the
  `parse_error` safe-stop and all its tests. Notes accumulate exactly as today.

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
  `POST /api/v1/calls`.
- `getCall(id): Promise<DialCall>` → `GET /api/v1/calls/{id}`.
- `DialCall` = `{ id, status, duration, transcript, ... }` matching the documented `Call`
  schema. Base URL `https://getdial.ai`, overridable by `DIAL_BASE_URL` (for tests).
- Auth header from `apiKey`. Non-2xx throws an error carrying the status + body snippet.
- The HTTP layer is injectable (a `fetch`-shaped function) so tests run against a stub with
  no network.

### New: `src/dial/dialConductor.ts` — the per-call seam

First, introduce a `CallConductor` abstraction so `runOperation` is agnostic to *how* a call
is conducted:

```ts
interface ConductedCall { transcript: Turn[]; endedReason: string; }
interface CallConductor {
  conduct(order: CallOrder, person: Person, objective: Objective): Promise<ConductedCall>;
}
```

- `SimulatedConductor` — extracts today's inline per-hop logic from `runOperation`
  (makeAgent + makeTarget + makeCallEngine + `runCampaign`) **verbatim**, so the default
  path is byte-for-byte unchanged. `runOperation` is refactored to call
  `conductor.conduct(...)` instead of inlining that block; it keeps emitting the same
  `hop.started` / `call.*` / `hop.ended` events and writing the same hop JSON.
- `DialConductor` — places a real call:
  1. Build `outboundInstruction` from the order: persona, objective description, the allowed
     tactics, and the target's public facts. This is the caller persona's system prompt.
     **It never contains the secret** (the operator never knows it; the conductor does not
     inject it).
  2. **Dry-run gate (default for the Dial backend):** when `VISH_DIAL_DRY_RUN` is not
     explicitly `false`, do **not** dial — log the `{ to, fromNumberId, outboundInstruction }`
     it *would* send and return an empty transcript with `endedReason: 'dial_dry_run'`. This
     is the default so wiring Dial on never silently places real calls until explicitly
     enabled.
  3. Live mode (`VISH_DIAL_DRY_RUN=false`): `makeCall(...)` to `person.phone`, then poll
     `getCall(id)` on an interval (config `DIAL_POLL_MS`, default 3000) up to a timeout
     (`DIAL_TIMEOUT_MS`, default 300000) until status is terminal. Parse the returned
     `transcript` string into `Turn[]` (a `parseDialTranscript` helper, line-based:
     speaker-labelled lines → turns, attributing the agent vs. the human). Map terminal
     status → `endedReason`.

### Wiring: `runScenario`/`runOperation`

- `VISH_CALL_BACKEND` — `simulated` (default) | `dial`. `runOperationScenario` constructs the
  conductor and passes it to `runOperation`.
- `dial` requires `DIAL_API_KEY` and `DIAL_FROM_NUMBER_ID`; missing either is a clear startup
  error (not a silent fall-back to simulated). The dry-run default still applies, so even a
  fully configured Dial backend does not dial until `VISH_DIAL_DRY_RUN=false`.
- The leak check after a Dial call uses the existing `SecretLeakExtractor` over the parsed
  transcript and the per-person fixture secret, exactly as the simulated path does. (For a
  genuinely real engagement the operator still never sees the secret; the extractor is how the
  harness scores a leak.)

## Configuration summary

| Env var | Default | Meaning |
|---|---|---|
| `VISH_OPERATOR_BACKEND` | `ai` | Operator brain: `ai` (Vercel AI SDK) or `claude` (subprocess) |
| `VISH_OPERATOR_PROVIDER` | `google` | AI SDK provider when backend is `ai` |
| `VISH_OPERATOR_MODEL` | `gemini-2.5-flash` | Model id for the AI SDK operator |
| `VISH_CALL_BACKEND` | `simulated` | Call conductor: `simulated` or `dial` |
| `VISH_DIAL_DRY_RUN` | `true` | When not `false`, Dial logs the call instead of dialing |
| `DIAL_API_KEY` | — | `sk_live_...` bearer key (required for live Dial) |
| `DIAL_FROM_NUMBER_ID` | — | Dial number id to call from (required for live Dial) |
| `DIAL_BASE_URL` | `https://getdial.ai` | Override for tests |
| `DIAL_POLL_MS` / `DIAL_TIMEOUT_MS` | `3000` / `300000` | Poll interval / overall timeout |

## Testing

All new tests are offline/deterministic; no live model or phone calls in CI.

- **`src/ai/model.ts`** — provider/model resolution: default is google + `gemini-2.5-flash`;
  env overrides; unknown provider throws.
- **`AiOperator`** — inject a fake model (or a small seam over `generateText`) returning canned
  JSON text; assert it produces the right `OperatorDecision` and accumulates notes. A garbage
  model output yields a `parse_error` stop (delegated to the existing parser).
- **`operatorPrompt.ts`** — golden assertions that the extracted helpers render the same text
  the current `ClaudeOperator` produced (guards the refactor).
- **`dialClient.ts`** — against a stub `fetch`: correct method/url/headers/body for `makeCall`
  and `getCall`; non-2xx throws with a useful message.
- **`parseDialTranscript`** — speaker-labelled transcript string → `Turn[]`.
- **`DialConductor`** — dry-run returns `dial_dry_run` and never calls `fetch`; live mode
  (stubbed client) polls until terminal and returns the parsed transcript; the built
  `outboundInstruction` never contains the secret.
- **`SimulatedConductor` / `runOperation`** — the existing `runOperation` tests must pass
  unchanged after the refactor (proof the extraction is behavior-preserving).

## Risks / open questions

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
