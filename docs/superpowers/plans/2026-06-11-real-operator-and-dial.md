# Real Operator (Vercel AI SDK) + getdial.ai Call Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the operator's brain from a `claude -p` subprocess to a model-agnostic Vercel AI SDK agent (default Gemini Flash), and add a getdial.ai backend that places real outbound voice calls — both behind existing interfaces so the deterministic test suite is untouched.

**Architecture:** Part 1 keeps the `Operator` interface and adds `AiOperator` alongside `ClaudeOperator`; shared prompt text is extracted to `operatorPrompt.ts`. Part 2 introduces a `CallConductor` seam one level above `CallEngine` (because Dial is autonomous, not turn-based): `SimulatedConductor` wraps today's per-hop logic verbatim and `DialConductor` places a real call and polls for the transcript. Backends are selected by env var, defaulting to AI operator + simulated calls.

**Tech Stack:** TypeScript (ESM/NodeNext, `.js` import suffixes), vitest, `ai` + `@ai-sdk/google` / `@ai-sdk/anthropic` / `@ai-sdk/openai`, Node `fetch`.

**Spec:** `docs/superpowers/specs/2026-06-11-real-operator-and-dial-design.md`

---

## File Structure

**Part 1 — Operator**
- Create `src/ai/model.ts` — env → AI SDK `LanguageModel` factory.
- Create `src/operator/operatorPrompt.ts` — shared `SYSTEM` + prompt-render helpers (extracted from `claudeOperator.ts`).
- Create `src/operator/aiOperator.ts` — `AiOperator implements Operator`.
- Modify `src/operator/claudeOperator.ts` — import the shared prompt module instead of defining it inline.
- Modify `src/orchestrator/runScenario.ts` — pick operator backend by env.

**Part 2 — Dial**
- Create `src/dial/dialClient.ts` — thin `fetch` wrapper over `POST/GET /api/v1/calls`.
- Create `src/dial/dialStatus.ts` — status terminal-check + `endedReason` mapping.
- Create `src/dial/parseDialTranscript.ts` — transcript string → `Turn[]`.
- Create `src/conductor/callConductor.ts` — `CallConductor` / `ConductCtx` / `ConductedCall` types.
- Create `src/conductor/simulatedConductor.ts` — wraps today's per-hop logic.
- Create `src/dial/dialConductor.ts` — `DialConductor` + `buildOutboundInstruction`.
- Modify `src/orchestrator/runOperation.ts` — call a `CallConductor` instead of inlining the per-hop block; add optional `conductor` arg.
- Modify `src/types.ts` — widen `call.ended` event `reason` to `string`.
- Modify `src/orchestrator/runScenario.ts` — pick call backend by env.

**Tests** (in `tests/`, matching the existing flat layout): `model.test.ts`, `operatorPrompt.test.ts`, `aiOperator.test.ts`, `dialClient.test.ts`, `dialStatus.test.ts`, `parseDialTranscript.test.ts`, `dialConductor.test.ts`, `simulatedConductor.test.ts`. The existing `runOperation.test.ts` and `parseDecision.test.ts` must keep passing unchanged.

**Conventions to follow** (verified in repo): all relative imports end in `.js`; tests import from `../src/...js`; `npm test` runs `vitest run`; `npm run typecheck` runs `tsc --noEmit`.

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the AI SDK packages**

Run:
```bash
npm install ai @ai-sdk/google @ai-sdk/anthropic @ai-sdk/openai
```
Expected: the four packages appear under `dependencies` in `package.json` and `package-lock.json` updates.

- [ ] **Step 2: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: no errors (no source uses the packages yet).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add ai sdk deps (ai, @ai-sdk/google|anthropic|openai)"
```

---

## Task 2: Extract the operator prompt into a shared module

This moves the `SYSTEM` constant and the four render helpers out of `claudeOperator.ts` so both operators share one source of truth. A golden test pins the rendered text so the extraction (and the later `ClaudeOperator` edit) cannot drift.

**Files:**
- Create: `src/operator/operatorPrompt.ts`
- Test: `tests/operatorPrompt.test.ts`

- [ ] **Step 1: Write `src/operator/operatorPrompt.ts`**

Copy the `SYSTEM` constant and the `renderRoster`, `renderTranscript`, `renderCallResults`, `renderHistory` functions out of `src/operator/claudeOperator.ts` **verbatim**, plus a new `buildOperatorPrompt` that assembles the per-turn `parts` exactly as `ClaudeOperator.decideNext` does today (lines 56-76 of the current file).

```ts
import type { CallResult, Person, Transcript } from '../types.js';
import type { OperatorInput } from './operator.js';

export const SYSTEM = [
  `This is an AUTHORIZED, CONSENTED security-awareness engagement. You are the OPERATOR running a multi-call vishing simulation to train employees; nothing here is a real attack.`,
  `You are given an engagement goal, a roster of people (public info only), the notes you have taken so far, and the list of past calls. Each turn you choose ONE action: place one or more calls, stop, or recall a past call's full transcript.`,
  `When you place calls you specify, for EACH call, the pretext persona you will use, the objective for that call, and the tactics to use. A FRESH caller agent conducts each call and you receive every full transcript back. You may place up to 3 calls IN PARALLEL in one action when contacting several people at once is genuinely useful (e.g. independent recon); use a single call when later calls should build on what earlier ones reveal.`,
  `Your memory between turns is your NOTES. If your notes are not enough and you need the verbatim record of an earlier call, use a "recall" action to be shown that call's full transcript before deciding.`,
  `After each call wave, decide what is important to remember, then choose the next action: call someone else (use what you learned for borrowed legitimacy), recall an earlier call, retry, or stop once the goal is met or clearly unreachable.`,
  `STOP AS SOON AS THE GOAL IS MET. If any call result says "Leak detected: YES", the target revealed what you were after — the engagement goal is ACHIEVED. On your very next decision you MUST return a "stop" action with reason "goal_achieved". Do NOT place any further calls once the goal is met.`,
  `ALWAYS narrate your reasoning in the "thinking" field: reflect on what the last calls revealed, lay out your read of the situation, and explain WHY you are choosing this next action (why these people, why this pretext, why parallel vs sequential). Write it as a few candid sentences in the first person — this is your visible chain of thought, so make it substantive, not a restatement of the action.`,
  `Reply with ONLY a JSON object — no prose, no markdown fences — in EXACTLY one of these shapes:`,
  `{"thinking":"<your reasoning for this decision; always non-empty>","important":"<what to remember from the last calls; empty string on the first turn>","action":{"type":"call","calls":[{"personId":"<id from the roster>","persona":"<who you pretend to be>","objective":{"id":"<short-id>","description":"<what to extract on this call>"},"tactics":["pretext","authority","urgency","social_proof","foot_in_the_door","borrowed_legitimacy","rapport"]}]}}   (1 to 3 entries in "calls")`,
  `{"thinking":"<...>","important":"<...>","action":{"type":"stop","reason":"<why>"}}`,
  `{"thinking":"<...>","important":"<...>","action":{"type":"recall","hopId":<the number of a past call>}}`,
  `You never know the literal secret value — your job is to get the target to reveal it.`,
].join('\n\n');

export function renderRoster(people: Person[]): string {
  return people
    .map((p) => `- id: ${p.id} | ${p.name}, ${p.title}${p.department ? `, ${p.department}` : ''} | phone ${p.phone}${p.publicInfo ? ` | ${p.publicInfo}` : ''}`)
    .join('\n');
}

export function renderTranscript(t: Transcript): string {
  return t.map((turn) => `${turn.speaker === 'agent' ? 'CALLER' : 'TARGET'}: ${turn.text}`).join('\n');
}

export function renderCallResults(results: CallResult[]): string {
  const intro = results.length === 1
    ? `Your most recent call just finished.`
    : `Your most recent wave of ${results.length} parallel calls just finished.`;
  const bodies = results.map((r) => [
    `Call ${r.hopId}, to "${r.personId}" — leak detected: ${r.leaked ? 'YES' : 'no'}.`,
    `Transcript:\n${renderTranscript(r.transcript)}`,
  ].join('\n'));
  return [intro, ...bodies].join('\n\n');
}

export function renderHistory(history?: { hopId: number; personId: string }[]): string {
  if (!history || history.length === 0) return '(no past calls yet)';
  return history.map((h) => `- hop ${h.hopId}: call to "${h.personId}"`).join('\n');
}

/** Assembles the per-turn user prompt — identical text to ClaudeOperator's previous inline build. */
export function buildOperatorPrompt(
  goal: string,
  roster: Person[],
  notes: string[],
  input: OperatorInput,
): string {
  const memory = notes.length ? notes.map((n, i) => `${i + 1}. ${n}`).join('\n') : '(no notes yet)';
  const parts = [
    `Engagement goal: ${goal}`,
    `Roster (public info only):\n${renderRoster(roster)}`,
    `Your notes so far:\n${memory}`,
    `Past calls you can recall in full:\n${renderHistory(input.history)}`,
  ];
  if (input.recalled) {
    parts.push(
      `Full transcript of hop ${input.recalled.hopId} you requested:\n${renderTranscript(input.recalled.transcript)}\n\nNow return your next JSON decision (call or stop; recall again only if truly needed).`,
    );
  } else if (input.last) {
    parts.push(`${renderCallResults(input.last)}\n\nReturn your JSON decision: distill what is important, then your next action.`);
  } else {
    parts.push(`This is your FIRST turn — no call has happened, so "important" MUST be an empty string. Still fill "thinking" with your opening strategy: how you read the roster and the goal, and why your first call(s) are the right entry point. Return your JSON decision for the first call.`);
  }
  return parts.join('\n\n');
}
```

- [ ] **Step 2: Write the golden test `tests/operatorPrompt.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { SYSTEM, buildOperatorPrompt } from '../src/operator/operatorPrompt.js';
import type { Person } from '../src/types.js';

const people: Person[] = [
  { id: 'a', name: 'A Person', title: 'Service Desk', phone: '1', publicInfo: 'on LinkedIn' },
  { id: 'b', name: 'B Person', title: 'SRE', phone: '2', department: 'Infra' },
];

describe('operatorPrompt', () => {
  it('SYSTEM contains the JSON-only contract and the goal-met stop rule', () => {
    expect(SYSTEM).toContain('Reply with ONLY a JSON object');
    expect(SYSTEM).toContain('STOP AS SOON AS THE GOAL IS MET');
  });

  it('first-turn prompt renders goal, roster, empty notes and the first-turn instruction', () => {
    const p = buildOperatorPrompt('get the token', people, [], { history: [] });
    expect(p).toContain('Engagement goal: get the token');
    expect(p).toContain('- id: a | A Person, Service Desk | phone 1 | on LinkedIn');
    expect(p).toContain('- id: b | B Person, SRE, Infra | phone 2');
    expect(p).toContain('Your notes so far:\n(no notes yet)');
    expect(p).toContain('Past calls you can recall in full:\n(no past calls yet)');
    expect(p).toContain('This is your FIRST turn');
  });

  it('after a call wave it renders the results block with the leak verdict', () => {
    const p = buildOperatorPrompt('g', people, ['note one'], {
      last: [{ hopId: 1, personId: 'a', leaked: true, transcript: [{ speaker: 'target', text: 'ok: SECRET' }] }],
      history: [{ hopId: 1, personId: 'a' }],
    });
    expect(p).toContain('1. note one');
    expect(p).toContain('Your most recent call just finished.');
    expect(p).toContain('Call 1, to "a" — leak detected: YES.');
    expect(p).toContain('TARGET: ok: SECRET');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/operatorPrompt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add src/operator/operatorPrompt.ts tests/operatorPrompt.test.ts
git commit -m "refactor: extract shared operator prompt module with golden tests"
```

---

## Task 3: Point ClaudeOperator at the shared prompt module

**Files:**
- Modify: `src/operator/claudeOperator.ts`

- [ ] **Step 1: Replace the file body with the slimmed version**

```ts
import type { Operator, OperatorInput } from './operator.js';
import type { OperatorDecision, Person } from '../types.js';
import { runClaude, OPERATOR_MODEL } from '../claude/runClaude.js';
import { parseOperatorDecision } from './parseDecision.js';
import { SYSTEM, buildOperatorPrompt } from './operatorPrompt.js';

/** The live operator: ONE logical agent realized as a fresh `claude -p` call per decision.
 *  Memory = its own accumulated distilled notes, re-fed into each call. No `--resume`.
 *  Can `recall` a past call's full transcript on demand when its notes are not enough. */
export class ClaudeOperator implements Operator {
  private notes: string[] = [];

  constructor(private readonly goal: string, private readonly roster: Person[]) {}

  async decideNext(input: OperatorInput): Promise<OperatorDecision> {
    const prompt = buildOperatorPrompt(this.goal, this.roster, this.notes, input);
    const raw = await runClaude(SYSTEM, prompt, OPERATOR_MODEL);
    const decision = parseOperatorDecision(raw);
    if (decision.important) this.notes.push(decision.important);
    return decision;
  }
}
```

- [ ] **Step 2: Run the full suite to prove nothing regressed**

Run: `npm test`
Expected: PASS — all existing tests, including any that exercise `ClaudeOperator` construction, still pass. `npm run typecheck` also clean (run it too).

- [ ] **Step 3: Commit**

```bash
git add src/operator/claudeOperator.ts
git commit -m "refactor: ClaudeOperator uses shared operatorPrompt module"
```

---

## Task 4: AI SDK model factory

**Files:**
- Create: `src/ai/model.ts`
- Test: `tests/model.test.ts`

- [ ] **Step 1: Write the failing test `tests/model.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveModelSpec } from '../src/ai/model.js';

describe('resolveModelSpec', () => {
  it('defaults to google + gemini-2.5-flash', () => {
    expect(resolveModelSpec({})).toEqual({ provider: 'google', modelId: 'gemini-2.5-flash' });
  });

  it('honors VISH_OPERATOR_PROVIDER and VISH_AI_OPERATOR_MODEL', () => {
    expect(resolveModelSpec({ VISH_OPERATOR_PROVIDER: 'anthropic', VISH_AI_OPERATOR_MODEL: 'claude-sonnet-4-6' }))
      .toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
  });

  it('falls back to a sensible default model id per provider when none is set', () => {
    expect(resolveModelSpec({ VISH_OPERATOR_PROVIDER: 'openai' }).modelId).toBe('gpt-4o-mini');
  });

  it('throws on an unknown provider, naming the accepted values', () => {
    expect(() => resolveModelSpec({ VISH_OPERATOR_PROVIDER: 'cohere' })).toThrow(/google.*anthropic.*openai/);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/model.test.ts`
Expected: FAIL — `resolveModelSpec` not found.

- [ ] **Step 3: Implement `src/ai/model.ts`**

`resolveModelSpec` is the pure, env-only part (unit-tested). `getOperatorModel` builds the actual `LanguageModel` (not unit-tested — it just dispatches to the provider factory).

```ts
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export type Provider = 'google' | 'anthropic' | 'openai';

const DEFAULT_MODEL: Record<Provider, string> = {
  google: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
};

export interface ModelSpec { provider: Provider; modelId: string; }

/** Pure env → spec resolution. Default provider google, default model per-provider.
 *  `VISH_AI_OPERATOR_MODEL` is deliberately distinct from `VISH_OPERATOR_MODEL`
 *  (the latter is the Claude-subprocess model in runClaude.ts). */
export function resolveModelSpec(env: Record<string, string | undefined>): ModelSpec {
  const provider = (env.VISH_OPERATOR_PROVIDER ?? 'google') as string;
  if (provider !== 'google' && provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`Unknown VISH_OPERATOR_PROVIDER "${provider}". Accepted: google, anthropic, openai.`);
  }
  const modelId = env.VISH_AI_OPERATOR_MODEL ?? DEFAULT_MODEL[provider];
  return { provider, modelId };
}

/** Builds the AI SDK LanguageModel from env. API keys come from each provider's standard
 *  env var (e.g. GOOGLE_GENERATIVE_AI_API_KEY) and are read by the provider factory itself. */
export function getOperatorModel(env: Record<string, string | undefined> = process.env): LanguageModel {
  const { provider, modelId } = resolveModelSpec(env);
  if (provider === 'anthropic') return anthropic(modelId);
  if (provider === 'openai') return openai(modelId);
  return google(modelId);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ai/model.ts tests/model.test.ts
git commit -m "feat: AI SDK model factory (env -> LanguageModel), default gemini flash"
```

---

## Task 5: AiOperator

**Files:**
- Create: `src/operator/aiOperator.ts`
- Test: `tests/aiOperator.test.ts`

- [ ] **Step 1: Write the failing test `tests/aiOperator.test.ts`**

The constructor takes an optional `generate` seam so tests need no model or network.

```ts
import { describe, it, expect, vi } from 'vitest';
import { AiOperator } from '../src/operator/aiOperator.js';
import type { Person } from '../src/types.js';

const people: Person[] = [{ id: 'a', name: 'A', title: 'Desk', phone: '1' }];

const callJson = JSON.stringify({
  thinking: 'start at the desk',
  important: '',
  action: { type: 'call', calls: [{ personId: 'a', persona: 'Marcus', objective: { id: 'o1', description: 'get token' }, tactics: ['authority'] }] },
});

describe('AiOperator', () => {
  it('builds the prompt, parses the model JSON into a decision', async () => {
    const generate = vi.fn().mockResolvedValue({ text: callJson });
    const op = new AiOperator('get the token', people, generate);
    const decision = await op.decideNext({ history: [] });

    expect(generate).toHaveBeenCalledOnce();
    const arg = generate.mock.calls[0][0];
    expect(arg.system).toContain('Reply with ONLY a JSON object');
    expect(arg.prompt).toContain('Engagement goal: get the token');
    expect(decision.action).toEqual({ type: 'call', calls: [{ personId: 'a', persona: 'Marcus', objective: { id: 'o1', description: 'get token' }, tactics: ['authority'] }] });
  });

  it('accumulates `important` into notes, surfacing them in the next turn prompt', async () => {
    const turn1 = JSON.stringify({ thinking: 't', important: 'note-X', action: { type: 'stop', reason: 'r' } });
    const turn2 = JSON.stringify({ thinking: 't', important: '', action: { type: 'stop', reason: 'done' } });
    const generate = vi.fn().mockResolvedValueOnce({ text: turn1 }).mockResolvedValueOnce({ text: turn2 });
    const op = new AiOperator('g', people, generate);

    await op.decideNext({ history: [] });
    await op.decideNext({ history: [] });

    // the first turn had no notes; the second turn's prompt shows the accumulated note
    expect(generate.mock.calls[0][0].prompt).toContain('Your notes so far:\n(no notes yet)');
    expect(generate.mock.calls[1][0].prompt).toContain('1. note-X');
  });

  it('returns a parse_error stop on garbage model output', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'I cannot help with that.' });
    const op = new AiOperator('g', people, generate);
    const decision = await op.decideNext({ history: [] });
    expect(decision.action).toEqual({ type: 'stop', reason: 'parse_error' });
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/aiOperator.test.ts`
Expected: FAIL — `AiOperator` not found.

- [ ] **Step 3: Implement `src/operator/aiOperator.ts`**

```ts
import { generateText } from 'ai';
import type { Operator, OperatorInput } from './operator.js';
import type { OperatorDecision, Person } from '../types.js';
import { parseOperatorDecision } from './parseDecision.js';
import { SYSTEM, buildOperatorPrompt } from './operatorPrompt.js';
import { getOperatorModel } from '../ai/model.js';

/** Model-agnostic operator on the Vercel AI SDK. Same contract and prompts as ClaudeOperator;
 *  only the model call differs. `generate` is injectable so tests need no model or network. */
export type GenerateFn = (args: { system: string; prompt: string }) => Promise<{ text: string }>;

const defaultGenerate: GenerateFn = async ({ system, prompt }) => {
  const { text } = await generateText({ model: getOperatorModel(), system, prompt });
  return { text };
};

export class AiOperator implements Operator {
  private notes: string[] = [];

  constructor(
    private readonly goal: string,
    private readonly roster: Person[],
    private readonly generate: GenerateFn = defaultGenerate,
  ) {}

  async decideNext(input: OperatorInput): Promise<OperatorDecision> {
    const prompt = buildOperatorPrompt(this.goal, this.roster, this.notes, input);
    const { text } = await this.generate({ system: SYSTEM, prompt });
    const decision = parseOperatorDecision(text);
    if (decision.important) this.notes.push(decision.important);
    return decision;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/aiOperator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/operator/aiOperator.ts tests/aiOperator.test.ts
git commit -m "feat: AiOperator (Vercel AI SDK) behind the Operator interface"
```

---

## Task 6: Select the operator backend in runScenario

**Files:**
- Modify: `src/orchestrator/runScenario.ts`

- [ ] **Step 1: Add the import and the backend switch**

Near the top imports, add:
```ts
import { AiOperator } from '../operator/aiOperator.js';
```

In `runOperationScenario`, replace the operator construction. The current line is:
```ts
    operator: new ClaudeOperator(scenario.goal, roster),
```
Replace with:
```ts
    operator: (process.env.VISH_OPERATOR_BACKEND ?? 'ai') === 'claude'
      ? new ClaudeOperator(scenario.goal, roster)
      : new AiOperator(scenario.goal, roster),
```

(`ClaudeOperator` is already imported in this file — keep that import.)

- [ ] **Step 2: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: PASS. No test sets `VISH_OPERATOR_BACKEND`, and `runScenario`'s live path isn't exercised in CI (it would spawn a model), so behavior in tests is unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator/runScenario.ts
git commit -m "feat: select operator backend via VISH_OPERATOR_BACKEND (default ai)"
```

---

## Task 7: CallConductor seam + SimulatedConductor + runOperation refactor

This is the behavior-preserving refactor. The acceptance gate is that **`tests/runOperation.test.ts` passes unchanged**.

**Files:**
- Create: `src/conductor/callConductor.ts`
- Create: `src/conductor/simulatedConductor.ts`
- Modify: `src/orchestrator/runOperation.ts`
- Test: `tests/simulatedConductor.test.ts`

- [ ] **Step 1: Create `src/conductor/callConductor.ts`**

```ts
import type { CallOrder, Fact, Objective, Person, Turn } from '../types.js';

/** Result of conducting one ordered call. `keyInfo` is the leak verdict
 *  (runOperation reads `keyInfo.length > 0` as `leaked`). `endedReason` is a free string
 *  so backends can report outcomes outside the simulated union (e.g. 'dial_timeout'). */
export interface ConductedCall {
  transcript: Turn[];
  endedReason: string;
  keyInfo: Fact[];
}

/** Everything a conductor needs for one call that varies per hop. Stable collaborators
 *  (stores, bus, factories, client) are injected at conductor construction instead. */
export interface ConductCtx {
  order: CallOrder;
  person: Person;
  objective: Objective;   // includes the fixture secret (used only for leak scoring)
  hopId: number;
  conversationId: string; // `${operationId}-hop-${hopId}`
  campaignId: string;     // = operationId
}

export interface CallConductor {
  conduct(ctx: ConductCtx): Promise<ConductedCall>;
}
```

- [ ] **Step 2: Create `src/conductor/simulatedConductor.ts`**

Wraps today's per-hop logic. The factory calls run synchronously before the first `await`, preserving the array-order determinism `runOperation` relies on.

```ts
import type { Agent } from '../agent/agent.js';
import type { Target } from '../target/target.js';
import type { CallEngine } from '../callEngine/callEngine.js';
import type { KnowledgeBase } from '../knowledge/knowledgeBase.js';
import type { ConversationStore } from '../store/conversationStore.js';
import type { KeyInfoStore } from '../store/keyInfoStore.js';
import type { KeyInfoExtractor } from '../extract/keyInfoExtractor.js';
import type { EventBus } from '../events/eventBus.js';
import { MockCallEngine } from '../callEngine/mockCallEngine.js';
import { runCampaign } from '../orchestrator/runCampaign.js';
import type { CallConductor, ConductCtx, ConductedCall } from './callConductor.js';

export interface SimulatedConductorDeps {
  makeAgent: (persona: string, personId?: string) => Agent;
  makeTarget: (personId: string, persona: string, secret?: string) => Target;
  makeCallEngine?: (target: Target) => CallEngine;
  kb: KnowledgeBase;
  fixtures: Record<string, { secret?: string; targetPersona: string }>;
  conversationStore: ConversationStore;
  keyInfoStore: KeyInfoStore;
  extractor: KeyInfoExtractor;
  bus: EventBus;
}

export class SimulatedConductor implements CallConductor {
  private readonly makeCallEngine: (target: Target) => CallEngine;
  constructor(private readonly deps: SimulatedConductorDeps) {
    this.makeCallEngine = deps.makeCallEngine ?? ((t) => new MockCallEngine(t));
  }

  async conduct(ctx: ConductCtx): Promise<ConductedCall> {
    const { order, objective, conversationId, campaignId } = ctx;
    // Synchronous prefix (factory calls) — preserves runOperation's array-order determinism.
    const agent = this.deps.makeAgent(order.persona, order.personId);
    const target = this.deps.makeTarget(order.personId, this.deps.fixtures[order.personId]?.targetPersona ?? '', objective.secret);
    const callEngine = this.makeCallEngine(target);

    const { conversation, keyInfo } = await runCampaign({
      conversationId,
      campaignId,
      targetId: order.personId,
      objective,
      allowedTactics: order.tactics,
      persona: order.persona,
      agent,
      callEngine,
      kb: this.deps.kb,
      conversationStore: this.deps.conversationStore,
      keyInfoStore: this.deps.keyInfoStore,
      extractor: this.deps.extractor,
      bus: this.deps.bus,
    });

    return { transcript: conversation.transcript, endedReason: conversation.endedReason, keyInfo };
  }
}
```

- [ ] **Step 3: Refactor `src/orchestrator/runOperation.ts`**

Add the import:
```ts
import type { CallConductor } from '../conductor/callConductor.js';
import { SimulatedConductor } from '../conductor/simulatedConductor.js';
```
Add an optional field to `RunOperationArgs` (anywhere in the interface):
```ts
  /** How each call is conducted. Defaults to a SimulatedConductor built from the
   *  makeAgent/makeTarget/makeCallEngine factories — i.e. today's behavior. */
  conductor?: CallConductor;
```
Replace the `makeCallEngine` default line near the top of `runOperation`:
```ts
  const makeCallEngine = args.makeCallEngine ?? ((t: Target) => new MockCallEngine(t));
```
with the conductor default:
```ts
  const conductor = args.conductor ?? new SimulatedConductor({
    makeAgent: args.makeAgent,
    makeTarget: args.makeTarget,
    makeCallEngine: args.makeCallEngine,
    kb: args.roster,
    fixtures: args.fixtures,
    conversationStore: args.conversationStore,
    keyInfoStore: args.keyInfoStore,
    extractor: args.extractor,
    bus: args.bus,
  });
```
Then replace the per-hop body inside `Promise.all(orders.map(async (order, i) => { ... }))` (the block currently spanning the `hopId`/`objective`/`agent`/`target`/`runCampaign`/`leaked`/`hop`/`writeFile`/`hop.ended` lines) with:
```ts
    const results = await Promise.all(orders.map(async (order, i) => {
      const hopId = baseHop + i + 1;
      const objective: Objective = { ...order.objective, secret: args.fixtures[order.personId]?.secret };
      const person = people[i]!;

      const { transcript, endedReason, keyInfo } = await conductor.conduct({
        order,
        person,
        objective,
        hopId,
        conversationId: `${args.operationId}-hop-${hopId}`,
        campaignId: args.operationId,
      });

      const leaked = keyInfo.length > 0;
      const hop: OperationHop = {
        hopId,
        personId: order.personId,
        persona: order.persona,
        objective,
        transcript,
        endedReason,
        leaked,
      };
      await writeFile(join(opDir, 'calls', `hop-${hopId}-${order.personId}.json`), JSON.stringify(hop, null, 2));
      args.bus.emit({ type: 'hop.ended', operationId: args.operationId, hopId, personId: order.personId, leaked });
      return hop;
    }));
```
Remove the now-unused imports if `MockCallEngine` / `Target` / `runCampaign` are no longer referenced elsewhere in the file (the `Target` type import and `MockCallEngine` import become unused — delete them; `runCampaign` import becomes unused — delete it). Leave `Promise.all`, the wave announcement, and everything else intact.

- [ ] **Step 4: Write `tests/simulatedConductor.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { SimulatedConductor } from '../src/conductor/simulatedConductor.js';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { RosterKnowledgeBase } from '../src/knowledge/rosterKnowledgeBase.js';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../src/store/keyInfoStore.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import type { Person } from '../src/types.js';

const people: Person[] = [{ id: 'a', name: 'A', title: 'Desk', phone: '1' }];

function conductor() {
  return new SimulatedConductor({
    makeAgent: (persona) => new ScriptedAgent([`hi ${persona}`, 'the token please', 'done']),
    makeTarget: (_id, _p, secret) => new ScriptedTarget(['who is this?', `ok: ${secret}`]),
    kb: new RosterKnowledgeBase(people),
    fixtures: { a: { secret: 'SECRET-A', targetPersona: 'helpful' } },
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus: new InMemoryEventBus(),
  });
}

describe('SimulatedConductor', () => {
  it('runs a campaign and returns transcript + leak verdict', async () => {
    const res = await conductor().conduct({
      order: { personId: 'a', persona: 'Marcus', objective: { id: 'o1', description: 'get token' }, tactics: ['authority'] },
      person: people[0],
      objective: { id: 'o1', description: 'get token', secret: 'SECRET-A' },
      hopId: 1,
      conversationId: 'op-hop-1',
      campaignId: 'op',
    });
    expect(res.keyInfo).toEqual([{ key: 'secret_leaked', value: 'SECRET-A' }]);
    expect(res.transcript.some((t) => t.speaker === 'target' && t.text.includes('SECRET-A'))).toBe(true);
  });
});
```

- [ ] **Step 5: Run the conductor test AND the untouched runOperation suite**

Run: `npx vitest run tests/simulatedConductor.test.ts tests/runOperation.test.ts`
Expected: PASS — the new conductor test passes AND all six `runOperation` tests pass with no edits to that test file. If any `runOperation` test fails, the refactor changed behavior — fix the refactor, not the test.

- [ ] **Step 6: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/conductor/callConductor.ts src/conductor/simulatedConductor.ts src/orchestrator/runOperation.ts tests/simulatedConductor.test.ts
git commit -m "refactor: introduce CallConductor seam; SimulatedConductor preserves runOperation behavior"
```

---

## Task 8: Dial REST client

**Files:**
- Create: `src/dial/dialClient.ts`
- Test: `tests/dialClient.test.ts`

- [ ] **Step 1: Write the failing test `tests/dialClient.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { DialClient } from '../src/dial/dialClient.js';

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('DialClient', () => {
  it('makeCall POSTs to /api/v1/calls with bearer auth and unwraps { call }', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ call: { id: 'call_1', status: 'initiated' } }));
    const client = new DialClient({ apiKey: 'sk_live_x', baseUrl: 'https://dial.test', fetchFn });
    const call = await client.makeCall({ to: '+1', fromNumberId: 'pn_1', outboundInstruction: 'hi' });

    expect(call).toEqual({ id: 'call_1', status: 'initiated' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://dial.test/api/v1/calls');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk_live_x');
    expect(JSON.parse(init.body)).toEqual({ to: '+1', fromNumberId: 'pn_1', outboundInstruction: 'hi' });
  });

  it('getCall GETs /api/v1/calls/{id} and unwraps { call }', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ call: { id: 'call_1', status: 'completed', transcript: 'AGENT: hi' } }));
    const client = new DialClient({ apiKey: 'k', baseUrl: 'https://dial.test', fetchFn });
    const call = await client.getCall('call_1');
    expect(call.status).toBe('completed');
    expect(fetchFn.mock.calls[0][0]).toBe('https://dial.test/api/v1/calls/call_1');
    expect(fetchFn.mock.calls[0][1].method).toBe('GET');
  });

  it('throws with status + body snippet on non-2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' } as Response);
    const client = new DialClient({ apiKey: 'k', baseUrl: 'https://dial.test', fetchFn });
    await expect(client.getCall('x')).rejects.toThrow(/401.*unauthorized/);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/dialClient.test.ts`
Expected: FAIL — `DialClient` not found.

- [ ] **Step 3: Implement `src/dial/dialClient.ts`**

```ts
export interface DialCall {
  id: string;
  status: string;
  duration?: number;
  transcript?: string | null;
  [k: string]: unknown;
}

export interface MakeCallInput {
  to: string;
  fromNumberId: string;
  outboundInstruction: string;
  language?: string;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface DialClientOpts {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: FetchFn;
}

/** Thin wrapper over Dial's REST calls. Field/path/status names are UNVERIFIED against a live
 *  account (the public docs were unreachable) — keep all Dial-specific shape assumptions here. */
export class DialClient {
  constructor(private readonly opts: DialClientOpts) {}

  private get base(): string { return this.opts.baseUrl ?? 'https://getdial.ai'; }
  private get fetchFn(): FetchFn { return this.opts.fetchFn ?? (globalThis.fetch as FetchFn); }

  async makeCall(input: MakeCallInput): Promise<DialCall> {
    const res = await this.fetchFn(`${this.base}/api/v1/calls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Dial makeCall ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return ((await res.json()) as { call: DialCall }).call;
  }

  async getCall(id: string): Promise<DialCall> {
    const res = await this.fetchFn(`${this.base}/api/v1/calls/${id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    if (!res.ok) throw new Error(`Dial getCall ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return ((await res.json()) as { call: DialCall }).call;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/dialClient.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/dial/dialClient.ts tests/dialClient.test.ts
git commit -m "feat: Dial REST client (makeCall/getCall) over injectable fetch"
```

---

## Task 9: Dial status mapping + transcript parser

**Files:**
- Create: `src/dial/dialStatus.ts`
- Create: `src/dial/parseDialTranscript.ts`
- Test: `tests/dialStatus.test.ts`
- Test: `tests/parseDialTranscript.test.ts`

- [ ] **Step 1: Write `tests/dialStatus.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isTerminal, endedReasonFor } from '../src/dial/dialStatus.js';

describe('dialStatus', () => {
  it('treats completed/ended/failed/no-answer/busy/canceled as terminal', () => {
    for (const s of ['completed', 'ended', 'failed', 'no-answer', 'busy', 'canceled', 'cancelled']) {
      expect(isTerminal(s)).toBe(true);
    }
  });

  it('treats in-progress states AND unknown states as non-terminal', () => {
    for (const s of ['initiated', 'ringing', 'in-progress', 'queued', 'something-new']) {
      expect(isTerminal(s)).toBe(false);
    }
  });

  it('maps completed/ended to "completed" and passes other terminal statuses through', () => {
    expect(endedReasonFor('completed')).toBe('completed');
    expect(endedReasonFor('ended')).toBe('completed');
    expect(endedReasonFor('no-answer')).toBe('no-answer');
  });
});
```

- [ ] **Step 2: Write `tests/parseDialTranscript.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseDialTranscript } from '../src/dial/parseDialTranscript.js';

describe('parseDialTranscript', () => {
  it('returns [] for null/empty', () => {
    expect(parseDialTranscript(null)).toEqual([]);
    expect(parseDialTranscript('')).toEqual([]);
  });

  it('maps speaker-labelled lines to agent/target turns', () => {
    const raw = 'AGENT: hello there\nUSER: who is this?\nAGENT: it is Marcus';
    expect(parseDialTranscript(raw)).toEqual([
      { speaker: 'agent', text: 'hello there' },
      { speaker: 'target', text: 'who is this?' },
      { speaker: 'agent', text: 'it is Marcus' },
    ]);
  });

  it('appends unlabelled continuation lines to the previous turn', () => {
    const raw = 'AGENT: hello\nthere again\nTARGET: hi';
    expect(parseDialTranscript(raw)).toEqual([
      { speaker: 'agent', text: 'hello there again' },
      { speaker: 'target', text: 'hi' },
    ]);
  });

  it('falls back to a single agent turn when there are no labels', () => {
    expect(parseDialTranscript('just some prose')).toEqual([{ speaker: 'agent', text: 'just some prose' }]);
  });
});
```

- [ ] **Step 3: Run both to verify failure**

Run: `npx vitest run tests/dialStatus.test.ts tests/parseDialTranscript.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `src/dial/dialStatus.ts`**

```ts
/** Dial status handling. Status strings are UNVERIFIED — confirm against a real response and
 *  adjust this set. Unknown statuses are treated as non-terminal so a new status can never be
 *  misread as "the call is done"; the conductor's timeout is the backstop. */
const TERMINAL = new Set(['completed', 'ended', 'failed', 'no-answer', 'busy', 'canceled', 'cancelled']);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

export function endedReasonFor(status: string): string {
  return status === 'completed' || status === 'ended' ? 'completed' : status;
}
```

- [ ] **Step 5: Implement `src/dial/parseDialTranscript.ts`**

```ts
import type { Turn } from '../types.js';

const AGENT_LABEL = /^(agent|caller|assistant|ai|bot)\s*:/i;
const TARGET_LABEL = /^(target|user|human|customer|callee|them)\s*:/i;

/** Best-effort parse of Dial's single transcript string into Turn[]. The real format is
 *  UNVERIFIED; this handles speaker-labelled lines and degrades to one agent turn rather
 *  than crashing when there are no recognizable labels. */
export function parseDialTranscript(raw: string | null | undefined): Turn[] {
  if (!raw || !raw.trim()) return [];
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const turns: Turn[] = [];
  let sawLabel = false;

  for (const line of lines) {
    if (AGENT_LABEL.test(line)) {
      sawLabel = true;
      turns.push({ speaker: 'agent', text: line.replace(AGENT_LABEL, '').trim() });
    } else if (TARGET_LABEL.test(line)) {
      sawLabel = true;
      turns.push({ speaker: 'target', text: line.replace(TARGET_LABEL, '').trim() });
    } else if (turns.length) {
      turns[turns.length - 1].text = `${turns[turns.length - 1].text} ${line}`.trim();
    } else {
      turns.push({ speaker: 'agent', text: line });
    }
  }

  if (!sawLabel) return [{ speaker: 'agent', text: raw.trim() }];
  return turns.filter((t) => t.text);
}
```

- [ ] **Step 6: Run both tests**

Run: `npx vitest run tests/dialStatus.test.ts tests/parseDialTranscript.test.ts`
Expected: PASS (3 + 4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/dial/dialStatus.ts src/dial/parseDialTranscript.ts tests/dialStatus.test.ts tests/parseDialTranscript.test.ts
git commit -m "feat: Dial status mapping + transcript parser (assumptions isolated)"
```

---

## Task 10: DialConductor

**Files:**
- Create: `src/dial/dialConductor.ts`
- Test: `tests/dialConductor.test.ts`

- [ ] **Step 1: Write the failing test `tests/dialConductor.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { DialConductor, buildOutboundInstruction } from '../src/dial/dialConductor.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import type { ConductCtx } from '../src/conductor/callConductor.js';
import type { Person } from '../src/types.js';

const person: Person = { id: 'a', name: 'Alex Doe', title: 'Service Desk', phone: '+15551234', publicInfo: 'on LinkedIn' };
const ctx: ConductCtx = {
  order: { personId: 'a', persona: 'Marcus from IT', objective: { id: 'o1', description: 'get the VPN code' }, tactics: ['authority', 'urgency'] },
  person,
  objective: { id: 'o1', description: 'get the VPN code', secret: 'VPN-9000' },
  hopId: 1,
  conversationId: 'op-hop-1',
  campaignId: 'op',
};

describe('buildOutboundInstruction', () => {
  it('includes persona, objective, person, tactics — and never the secret', () => {
    const inst = buildOutboundInstruction(ctx.order, person);
    expect(inst).toContain('Marcus from IT');
    expect(inst).toContain('get the VPN code');
    expect(inst).toContain('Alex Doe');
    expect(inst).toContain('authority');
    expect(inst).not.toContain('VPN-9000');
  });
});

describe('DialConductor', () => {
  it('dry-run returns a [DIAL DRY-RUN] turn, no dialing, no leak', async () => {
    const client = { makeCall: vi.fn(), getCall: vi.fn() };
    const conductor = new DialConductor({ client: client as any, fromNumberId: 'pn_1', extractor: new SecretLeakExtractor(), bus: new InMemoryEventBus(), dryRun: true });
    const res = await conductor.conduct(ctx);
    expect(client.makeCall).not.toHaveBeenCalled();
    expect(res.endedReason).toBe('dial_dry_run');
    expect(res.keyInfo).toEqual([]);
    expect(res.transcript[0].text).toContain('[DIAL DRY-RUN]');
    expect(res.transcript[0].text).toContain('+15551234');
  });

  it('live mode polls until terminal, parses the transcript, scores the leak', async () => {
    const client = {
      makeCall: vi.fn().mockResolvedValue({ id: 'call_1', status: 'initiated' }),
      getCall: vi.fn()
        .mockResolvedValueOnce({ id: 'call_1', status: 'ringing' })
        .mockResolvedValueOnce({ id: 'call_1', status: 'completed', transcript: 'AGENT: code please\nTARGET: ok it is VPN-9000' }),
    };
    const conductor = new DialConductor({
      client: client as any, fromNumberId: 'pn_1', extractor: new SecretLeakExtractor(),
      bus: new InMemoryEventBus(), dryRun: false, pollMs: 1, timeoutMs: 1000, sleep: async () => {},
    });
    const res = await conductor.conduct(ctx);
    expect(client.makeCall).toHaveBeenCalledOnce();
    expect(client.getCall).toHaveBeenCalledTimes(2);
    expect(res.endedReason).toBe('completed');
    expect(res.keyInfo).toEqual([{ key: 'secret_leaked', value: 'VPN-9000' }]);
  });

  it('returns dial_timeout when the call never reaches a terminal status', async () => {
    const client = {
      makeCall: vi.fn().mockResolvedValue({ id: 'call_1', status: 'initiated' }),
      getCall: vi.fn().mockResolvedValue({ id: 'call_1', status: 'in-progress', transcript: 'AGENT: hello' }),
    };
    const conductor = new DialConductor({
      client: client as any, fromNumberId: 'pn_1', extractor: new SecretLeakExtractor(),
      bus: new InMemoryEventBus(), dryRun: false, pollMs: 10, timeoutMs: 25, sleep: async () => {},
    });
    const res = await conductor.conduct(ctx);
    expect(res.endedReason).toBe('dial_timeout');
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/dialConductor.test.ts`
Expected: FAIL — `DialConductor` not found.

- [ ] **Step 3: Implement `src/dial/dialConductor.ts`**

```ts
import type { EventBus } from '../events/eventBus.js';
import type { KeyInfoExtractor } from '../extract/keyInfoExtractor.js';
import type { CallOrder, Person } from '../types.js';
import type { CallConductor, ConductCtx, ConductedCall } from '../conductor/callConductor.js';
import type { DialClient } from './dialClient.js';
import { isTerminal, endedReasonFor } from './dialStatus.js';
import { parseDialTranscript } from './parseDialTranscript.js';

/** The caller persona's system prompt for the Dial voice agent. Built from public info only —
 *  it MUST NOT contain the objective secret (the operator never knows it either). */
export function buildOutboundInstruction(order: CallOrder, person: Person): string {
  return [
    `You are ${order.persona}.`,
    `Your objective on this call: ${order.objective.description}.`,
    `You are calling ${person.name}, ${person.title}${person.publicInfo ? ` (${person.publicInfo})` : ''}.`,
    `Tactics you may use: ${order.tactics.join(', ') || 'none specified'}.`,
    `Stay in character for the entire call and do not break the persona.`,
  ].join(' ');
}

export interface DialConductorDeps {
  client: DialClient;
  fromNumberId: string;
  extractor: KeyInfoExtractor;
  bus: EventBus;
  dryRun: boolean;
  pollMs?: number;
  timeoutMs?: number;
  language?: string;
  sleep?: (ms: number) => Promise<void>;
}

export class DialConductor implements CallConductor {
  constructor(private readonly deps: DialConductorDeps) {}

  async conduct(ctx: ConductCtx): Promise<ConductedCall> {
    const instruction = buildOutboundInstruction(ctx.order, ctx.person);
    this.deps.bus.emit({ type: 'call.started', conversationId: ctx.conversationId });

    if (this.deps.dryRun) {
      const transcript = [{ speaker: 'agent' as const, text: `[DIAL DRY-RUN] would call ${ctx.person.phone} with instruction: ${instruction}` }];
      this.deps.bus.emit({ type: 'agent.turn', conversationId: ctx.conversationId, text: transcript[0].text });
      this.deps.bus.emit({ type: 'call.ended', conversationId: ctx.conversationId, reason: 'dial_dry_run' });
      return { transcript, endedReason: 'dial_dry_run', keyInfo: [] };
    }

    const pollMs = this.deps.pollMs ?? 3000;
    const timeoutMs = this.deps.timeoutMs ?? 300_000;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    const placed = await this.deps.client.makeCall({
      to: ctx.person.phone,
      fromNumberId: this.deps.fromNumberId,
      outboundInstruction: instruction,
      language: this.deps.language,
    });

    let latest = placed;
    let waited = 0;
    while (!isTerminal(latest.status) && waited < timeoutMs) {
      await sleep(pollMs);
      waited += pollMs;
      latest = await this.deps.client.getCall(placed.id);
    }

    const transcript = parseDialTranscript(latest.transcript);
    const endedReason = isTerminal(latest.status) ? endedReasonFor(latest.status) : 'dial_timeout';
    for (const t of transcript) {
      this.deps.bus.emit({ type: t.speaker === 'agent' ? 'agent.turn' : 'target.turn', conversationId: ctx.conversationId, text: t.text });
    }
    const keyInfo = await this.deps.extractor.extract(transcript, ctx.objective);
    this.deps.bus.emit({ type: 'call.ended', conversationId: ctx.conversationId, reason: endedReason });

    return { transcript, endedReason, keyInfo };
  }
}
```

- [ ] **Step 4: Widen the `call.ended` event reason in `src/types.ts`**

The `DialConductor` emits `reason: 'dial_dry_run'` / `'dial_timeout'` / `'completed'`, which aren't in the `Conversation['endedReason']` union. Widen ONLY the event's reason to `string` (both consumers — `terminalVisualizer.ts` and `web/server.ts` — already handle arbitrary strings). In `ConversationEvent`, change:
```ts
  | { type: 'call.ended'; conversationId: string; reason: Conversation['endedReason'] }
```
to:
```ts
  | { type: 'call.ended'; conversationId: string; reason: string }
```
Leave `Conversation['endedReason']` (the union on the `Conversation` object itself) unchanged — `runConversation` still only produces the three union values.

- [ ] **Step 5: Run the test + typecheck**

Run: `npx vitest run tests/dialConductor.test.ts && npm run typecheck`
Expected: PASS (1 + 3 tests) and clean typecheck. `runConversation.ts` still compiles because it only assigns union values to the widened field.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (everything, including the unchanged `runOperation` and `runConversation` tests).

- [ ] **Step 7: Commit**

```bash
git add src/dial/dialConductor.ts src/types.ts tests/dialConductor.test.ts
git commit -m "feat: DialConductor (dry-run default, poll-to-terminal, leak scoring)"
```

---

## Task 11: Wire the call backend into runScenario

**Files:**
- Modify: `src/orchestrator/runScenario.ts`

- [ ] **Step 1: Add imports**

```ts
import { DialClient } from '../dial/dialClient.js';
import { DialConductor } from '../dial/dialConductor.js';
import type { CallConductor } from '../conductor/callConductor.js';
```

- [ ] **Step 2: Build the conductor when the Dial backend is selected**

Inside `runOperationScenario`, before the `return runOperation({...})`, add a helper that returns a `CallConductor | undefined` (undefined = let `runOperation` default to `SimulatedConductor`):

```ts
  const callBackend = process.env.VISH_CALL_BACKEND ?? 'simulated';
  let conductor: CallConductor | undefined;
  if (callBackend === 'dial') {
    const apiKey = process.env.DIAL_API_KEY;
    const fromNumberId = process.env.DIAL_FROM_NUMBER_ID;
    if (!apiKey || !fromNumberId) {
      throw new Error('VISH_CALL_BACKEND=dial requires DIAL_API_KEY and DIAL_FROM_NUMBER_ID.');
    }
    conductor = new DialConductor({
      client: new DialClient({ apiKey, baseUrl: process.env.DIAL_BASE_URL }),
      fromNumberId,
      extractor: new SecretLeakExtractor(),
      bus,
      dryRun: process.env.VISH_DIAL_DRY_RUN !== 'false',
      pollMs: process.env.DIAL_POLL_MS ? Number(process.env.DIAL_POLL_MS) : undefined,
      timeoutMs: process.env.DIAL_TIMEOUT_MS ? Number(process.env.DIAL_TIMEOUT_MS) : undefined,
    });
  }
```

Then add `conductor,` to the object passed to `runOperation({ ... })`. (When `undefined`, `runOperation` builds the default `SimulatedConductor` from the factories — unchanged behavior.)

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS. No test sets `VISH_CALL_BACKEND`, so the default simulated path is exercised exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/runScenario.ts
git commit -m "feat: select call backend via VISH_CALL_BACKEND (dial dry-run by default)"
```

---

## Task 12: README / docs note for the new env vars

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the backends and env vars**

Append to `README.md`:

```markdown
## Backends & configuration

The operator (the thinking agent) and the call mechanism are each selectable by env var.

**Operator brain** — `VISH_OPERATOR_BACKEND`:
- `ai` (default) — Vercel AI SDK. Provider via `VISH_OPERATOR_PROVIDER` (`google` default / `anthropic` / `openai`), model via `VISH_AI_OPERATOR_MODEL` (default `gemini-2.5-flash`). Provider API key from the provider's standard env var (e.g. `GOOGLE_GENERATIVE_AI_API_KEY`).
- `claude` — the `claude -p` subprocess operator (model via the existing `VISH_OPERATOR_MODEL`, default `sonnet`).

**Call mechanism** — `VISH_CALL_BACKEND`:
- `simulated` (default) — Claude/mock role-players talk turn-by-turn (no real calls).
- `dial` — places REAL outbound voice calls via getdial.ai. Requires `DIAL_API_KEY` and `DIAL_FROM_NUMBER_ID`. **Dry-run is ON by default**: it logs the call it would place and does NOT dial until you set `VISH_DIAL_DRY_RUN=false`. Optional: `DIAL_BASE_URL`, `DIAL_POLL_MS` (3000), `DIAL_TIMEOUT_MS` (300000). The Dial request/response schema is unverified against a live account — capture one real call and confirm before enabling live mode. Use only for authorized, consented engagements.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document operator and call backend env vars"
```

---

## Final verification

- [ ] **Run the whole suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS — all pre-existing tests unchanged plus the new tests (`operatorPrompt`, `model`, `aiOperator`, `simulatedConductor`, `dialClient`, `dialStatus`, `parseDialTranscript`, `dialConductor`).

- [ ] **Confirm the default paths are untouched**

The default `runScenario` now uses `AiOperator` + `SimulatedConductor`. Because no test sets `VISH_OPERATOR_BACKEND`/`VISH_CALL_BACKEND` and the live `runScenario` path isn't run in CI, `npm test` proves the refactor preserved all scripted/offline behavior. Live smoke-testing the AI operator (needs a provider key) and Dial dry-run (needs Dial keys) is manual and out of CI scope.

---

## Self-review notes (addressed)

- **Spec coverage:** Part 1 → Tasks 2–6; Part 2 → Tasks 7–11; config table → Task 12; testing section → tests in each task. All spec env vars appear in Task 12's table.
- **Type consistency:** `ConductCtx`/`ConductedCall`/`CallConductor` defined in Task 7 are used identically in Tasks 7, 10, 11. `DialCall`/`MakeCallInput` (Task 8) used by `DialConductor` (Task 10). `GenerateFn` (Task 5) matches the stub shape in its test. `resolveModelSpec`/`getOperatorModel` (Task 4) consumed by `AiOperator` (Task 5).
- **Behavior preservation:** Task 7 keeps the `Promise.all` wave, the synchronous factory-call prefix, the `<op>-hop-<n>` conversationId, the hop JSON write, and `hop.ended` emission; acceptance gate is the unchanged `runOperation.test.ts`.
- **Naming collision:** `VISH_AI_OPERATOR_MODEL` (AI SDK) is distinct from the existing `VISH_OPERATOR_MODEL` (Claude subprocess).
