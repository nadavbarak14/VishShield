# VishShield Multi-Hop Operator Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent-driven multi-hop "chained calls" to VishShield: a single persistent operator agent decides who to call next from a people roster, receives each call transcript, distills what's important, and loops — while the existing single-call path stays untouched.

**Architecture:** A new **operator** layer sits *above* the existing `runCampaign`. `runOperation` is fully dependency-injected (operator + per-hop agent/target/call-engine factories + a `runsDir`) so the whole multi-hop flow runs offline in CI with scripted parts. The live operator is **one logical agent realized as a fresh `claude -p` call per decision** (reusing the existing `runClaude`), carrying its own distilled notes as memory — no `--resume`. A `RosterKnowledgeBase` supplies public people profiles, and per-person `secret`/`targetPersona` fixtures drive the mock target.

**Tech Stack:** TypeScript (ESM, Node ≥ 20), vitest (offline CI), `claude` CLI print mode (`claude -p --output-format json`) for the live run only.

**Spec:** `docs/superpowers/specs/2026-06-11-vishshield-multi-hop-operator-design.md`

---

## File structure

**Create:**
- `src/knowledge/rosterKnowledgeBase.ts` — `PeopleKnowledgeBase` interface + `RosterKnowledgeBase` class
- `src/operator/operator.ts` — `Operator` interface
- `src/operator/scriptedOperator.ts` — canned-decision operator (CI)
- `src/operator/parseDecision.ts` — pure `parseOperatorDecision(raw)` (offline-testable)
- `src/operator/claudeOperator.ts` — live operator: a fresh `claude -p` per decision (reuses `runClaude`), notes as memory
- `src/orchestrator/runOperation.ts` — `RunOperationArgs` + `runOperation` loop
- `src/orchestrator/scenarioKind.ts` — pure scenario discriminator
- `data/scenarios/scenario-b.json` — two-hop scenario (roster + goal)
- Tests: `tests/rosterKnowledgeBase.test.ts`, `tests/scriptedOperator.test.ts`, `tests/parseDecision.test.ts`, `tests/runOperation.test.ts`, `tests/scenarioKind.test.ts`

**Modify:**
- `src/types.ts` — add `Person`, `CallResult`, `OperatorDecision`, `OperationHop`, `OperationRun`, and `hop.started`/`hop.ended` events
- `src/orchestrator/runScenario.ts` — branch to the operation path; return `SavedRun | OperationRun`
- `src/cli/play.ts` — print the operation directory path for an `OperationRun`

**Untouched (and must keep passing):** `scenario-a.json`, `runCampaign.ts`, `runConversation.ts`, `mockKnowledgeBase.ts`, `claudeAgent.ts`, `scriptedAgent.ts`, all existing tests, `web/server.ts`.

---

### Task 1: Shared types and events

**Files:**
- Modify: `src/types.ts` (append new types; extend `ConversationEvent`)

- [ ] **Step 1: Append the new types to `src/types.ts`**

Add at the end of the file:

```ts
/** Public profile of a person in the roster. The attacker side sees ONLY this — never a secret. */
export interface Person {
  id: string;
  name: string;
  title: string;
  phone: string;
  department?: string;
  publicInfo?: string;
}

/** What the operator is handed after a call it ordered (undefined on the very first turn). */
export interface CallResult {
  personId: string;
  transcript: Transcript;
  leaked: boolean;
}

/** The operator's per-turn output: what to remember from the last call, plus the next action. */
export type OperatorDecision = {
  important: string;
  action:
    | {
        type: 'call';
        personId: string;
        persona: string;
        objective: { id: string; description: string };
        tactics: Tactic[];
      }
    | { type: 'stop'; reason: string }
    | { type: 'recall'; hopId: number };   // re-read a past call's full transcript on demand
};

export interface OperationHop {
  hopId: number;
  personId: string;
  persona: string;
  objective: Objective;
  transcript: Transcript;
  endedReason: string;
  leaked: boolean;
}

export interface OperationRun {
  id: string;
  goal: string;
  hops: OperationHop[];
  keyInfo: Fact[];        // flattened across hops; read by play.ts + web
  compromised: boolean;   // any hop leaked; read by web verdict
}
```

- [ ] **Step 2: Extend the `ConversationEvent` union**

In `src/types.ts`, change the `ConversationEvent` union from:

```ts
export type ConversationEvent =
  | { type: 'call.started'; conversationId: string }
  | { type: 'agent.turn'; conversationId: string; text: string }
  | { type: 'target.turn'; conversationId: string; text: string }
  | { type: 'call.ended'; conversationId: string; reason: Conversation['endedReason'] };
```

to (add the two `hop.*` variants):

```ts
export type ConversationEvent =
  | { type: 'call.started'; conversationId: string }
  | { type: 'agent.turn'; conversationId: string; text: string }
  | { type: 'target.turn'; conversationId: string; text: string }
  | { type: 'call.ended'; conversationId: string; reason: Conversation['endedReason'] }
  | { type: 'hop.started'; operationId: string; hopId: number; personId: string }
  | { type: 'hop.ended'; operationId: string; hopId: number; personId: string; leaked: boolean };
```

- [ ] **Step 3: Verify the project still typechecks**

Run: `npm run typecheck`
Expected: PASS (no errors). Adding variants is additive; existing `switch` statements have no `never` exhaustiveness guard, so they still compile.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add Person, operator decision, operation run, and hop events"
```

---

### Task 2: RosterKnowledgeBase (people KB)

**Files:**
- Create: `src/knowledge/rosterKnowledgeBase.ts`
- Test: `tests/rosterKnowledgeBase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/rosterKnowledgeBase.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RosterKnowledgeBase } from '../src/knowledge/rosterKnowledgeBase.js';
import type { Person } from '../src/types.js';

const people: Person[] = [
  { id: 'alex', name: 'Alex Romero', title: 'On-call SRE', phone: '+1-555-0142', department: 'Platform', publicInfo: 'joined 6mo ago' },
  { id: 'jordan', name: 'Jordan Pike', title: 'Service Desk', phone: '+1-555-0101' },
];

describe('RosterKnowledgeBase', () => {
  it('returns a public profile by id and the full roster', async () => {
    const kb = new RosterKnowledgeBase(people);
    expect((await kb.getPerson('alex'))?.name).toBe('Alex Romero');
    expect(await kb.getPerson('nobody')).toBeUndefined();
    expect((await kb.listPeople()).map((p) => p.id)).toEqual(['alex', 'jordan']);
  });

  it('projects a person into grounding facts (public fields only, optionals omitted)', async () => {
    const kb = new RosterKnowledgeBase(people);
    expect(await kb.getContext('alex')).toEqual([
      { key: 'name', value: 'Alex Romero' },
      { key: 'title', value: 'On-call SRE' },
      { key: 'phone', value: '+1-555-0142' },
      { key: 'department', value: 'Platform' },
      { key: 'public_info', value: 'joined 6mo ago' },
    ]);
    expect(await kb.getContext('jordan')).toEqual([
      { key: 'name', value: 'Jordan Pike' },
      { key: 'title', value: 'Service Desk' },
      { key: 'phone', value: '+1-555-0101' },
    ]);
    expect(await kb.getContext('nobody')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/rosterKnowledgeBase.test.ts`
Expected: FAIL — cannot find module `rosterKnowledgeBase.js`.

- [ ] **Step 3: Implement `RosterKnowledgeBase`**

Create `src/knowledge/rosterKnowledgeBase.ts`:

```ts
import type { KnowledgeBase } from './knowledgeBase.js';
import type { Fact, Person } from '../types.js';

/** The base KB contract plus people-directory lookups. NOT a widening of the shared
 *  KnowledgeBase interface — MockKnowledgeBase is intentionally left unchanged. */
export interface PeopleKnowledgeBase extends KnowledgeBase {
  getPerson(id: string): Promise<Person | undefined>;
  listPeople(): Promise<Person[]>;
}

export class RosterKnowledgeBase implements PeopleKnowledgeBase {
  private readonly byId: Map<string, Person>;
  private readonly order: string[];

  constructor(people: Person[]) {
    this.byId = new Map(people.map((p) => [p.id, p]));
    this.order = people.map((p) => p.id);
  }

  async getPerson(id: string): Promise<Person | undefined> {
    return this.byId.get(id);
  }

  async listPeople(): Promise<Person[]> {
    return this.order.map((id) => this.byId.get(id)!);
  }

  /** Projects a person's PUBLIC profile into grounding facts for the talker.
   *  Never includes any secret/targetPersona — those are not on Person. Unknown id → []. */
  async getContext(personId: string): Promise<Fact[]> {
    const p = this.byId.get(personId);
    if (!p) return [];
    const facts: Fact[] = [
      { key: 'name', value: p.name },
      { key: 'title', value: p.title },
      { key: 'phone', value: p.phone },
    ];
    if (p.department) facts.push({ key: 'department', value: p.department });
    if (p.publicInfo) facts.push({ key: 'public_info', value: p.publicInfo });
    return facts;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/rosterKnowledgeBase.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/rosterKnowledgeBase.ts tests/rosterKnowledgeBase.test.ts
git commit -m "feat(knowledge): add RosterKnowledgeBase people directory"
```

---

### Task 3: Operator interface + ScriptedOperator

**Files:**
- Create: `src/operator/operator.ts`, `src/operator/scriptedOperator.ts`
- Test: `tests/scriptedOperator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/scriptedOperator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ScriptedOperator } from '../src/operator/scriptedOperator.js';
import type { OperatorDecision } from '../src/types.js';

const callA: OperatorDecision = {
  important: '',
  action: { type: 'call', personId: 'a', persona: 'P', objective: { id: 'o', description: 'd' }, tactics: ['authority'] },
};
const stop: OperatorDecision = { important: 'learned X', action: { type: 'stop', reason: 'done' } };

describe('ScriptedOperator', () => {
  it('returns its canned decisions in order, then a safe stop when exhausted', async () => {
    const op = new ScriptedOperator([callA, stop]);
    expect(await op.decideNext({})).toEqual(callA);
    expect(await op.decideNext({})).toEqual(stop);
    expect((await op.decideNext({})).action).toEqual({ type: 'stop', reason: 'out_of_script' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/scriptedOperator.test.ts`
Expected: FAIL — cannot find module `scriptedOperator.js`.

- [ ] **Step 3: Implement the interface and scripted operator**

Create `src/operator/operator.ts`:

```ts
import type { CallResult, OperatorDecision, Transcript } from '../types.js';

/** What the operator is handed each turn. `last` is the call just placed (undefined on the
 *  first turn). `recalled` is a past call's full transcript served in response to a prior
 *  `recall` action. `history` lists the past calls available to recall. */
export interface OperatorInput {
  last?: CallResult;
  recalled?: { hopId: number; transcript: Transcript };
  history?: { hopId: number; personId: string }[];
}

export interface Operator {
  /** Decide the next action. The implementation owns its own memory across turns. */
  decideNext(input: OperatorInput): Promise<OperatorDecision>;
}
```

Create `src/operator/scriptedOperator.ts`:

```ts
import type { Operator, OperatorInput } from './operator.js';
import type { OperatorDecision } from '../types.js';

export class ScriptedOperator implements Operator {
  private i = 0;
  constructor(private readonly decisions: OperatorDecision[]) {}

  async decideNext(_input: OperatorInput): Promise<OperatorDecision> {
    if (this.i >= this.decisions.length) {
      return { important: '', action: { type: 'stop', reason: 'out_of_script' } };
    }
    return this.decisions[this.i++];
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/scriptedOperator.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/operator/operator.ts src/operator/scriptedOperator.ts tests/scriptedOperator.test.ts
git commit -m "feat(operator): add Operator interface and ScriptedOperator"
```

---

### Task 4: parseOperatorDecision (robust JSON parsing)

**Files:**
- Create: `src/operator/parseDecision.ts`
- Test: `tests/parseDecision.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/parseDecision.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseOperatorDecision } from '../src/operator/parseDecision.js';

describe('parseOperatorDecision', () => {
  it('parses a valid call decision wrapped in prose/markdown', () => {
    const raw = 'Sure, here is my decision:\n```json\n{"important":"","action":{"type":"call","personId":"alex","persona":"Marcus","objective":{"id":"o1","description":"get the token"},"tactics":["authority","urgency"]}}\n```';
    expect(parseOperatorDecision(raw)).toEqual({
      important: '',
      action: { type: 'call', personId: 'alex', persona: 'Marcus', objective: { id: 'o1', description: 'get the token' }, tactics: ['authority', 'urgency'] },
    });
  });

  it('parses a valid stop decision', () => {
    const raw = '{"important":"target refused","action":{"type":"stop","reason":"unreachable"}}';
    expect(parseOperatorDecision(raw)).toEqual({
      important: 'target refused',
      action: { type: 'stop', reason: 'unreachable' },
    });
  });

  it('parses a recall decision', () => {
    const raw = '{"important":"","action":{"type":"recall","hopId":1}}';
    expect(parseOperatorDecision(raw)).toEqual({ important: '', action: { type: 'recall', hopId: 1 } });
  });

  it('returns a safe parse_error stop on non-JSON', () => {
    expect(parseOperatorDecision('I think I should call Alex next.')).toEqual({
      important: '',
      action: { type: 'stop', reason: 'parse_error' },
    });
  });

  it('returns parse_error when a call decision is missing required fields', () => {
    const raw = '{"important":"","action":{"type":"call","persona":"Marcus","objective":{"id":"o1","description":"d"},"tactics":[]}}'; // no personId
    expect(parseOperatorDecision(raw).action).toEqual({ type: 'stop', reason: 'parse_error' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/parseDecision.test.ts`
Expected: FAIL — cannot find module `parseDecision.js`.

- [ ] **Step 3: Implement the parser**

Create `src/operator/parseDecision.ts`:

```ts
import type { OperatorDecision, Tactic } from '../types.js';

const PARSE_ERROR: OperatorDecision = { important: '', action: { type: 'stop', reason: 'parse_error' } };

/** Extracts the first JSON object from raw model text and validates it into an
 *  OperatorDecision. Any malformed or invalid shape returns a safe parse_error stop,
 *  so the operator loop can never crash on bad model output. Pure + offline-testable. */
export function parseOperatorDecision(raw: string): OperatorDecision {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return PARSE_ERROR;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return PARSE_ERROR;
  }
  if (typeof parsed !== 'object' || parsed === null) return PARSE_ERROR;

  const o = parsed as Record<string, unknown>;
  const important = typeof o.important === 'string' ? o.important : '';
  const action = o.action;
  if (typeof action !== 'object' || action === null) return PARSE_ERROR;
  const a = action as Record<string, unknown>;

  if (a.type === 'stop') {
    return { important, action: { type: 'stop', reason: typeof a.reason === 'string' ? a.reason : 'stop' } };
  }

  if (a.type === 'recall') {
    if (typeof a.hopId !== 'number' || !Number.isInteger(a.hopId)) return PARSE_ERROR;
    return { important, action: { type: 'recall', hopId: a.hopId } };
  }

  if (a.type === 'call') {
    const objective = a.objective as Record<string, unknown> | undefined;
    if (
      typeof a.personId !== 'string' ||
      typeof a.persona !== 'string' ||
      !objective || typeof objective.id !== 'string' || typeof objective.description !== 'string' ||
      !Array.isArray(a.tactics)
    ) {
      return PARSE_ERROR;
    }
    return {
      important,
      action: {
        type: 'call',
        personId: a.personId,
        persona: a.persona,
        objective: { id: objective.id, description: objective.description },
        tactics: a.tactics.filter((t): t is Tactic => typeof t === 'string') as Tactic[],
      },
    };
  }

  return PARSE_ERROR;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/parseDecision.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/operator/parseDecision.ts tests/parseDecision.test.ts
git commit -m "feat(operator): add robust parseOperatorDecision"
```

---

### Task 5: ClaudeOperator (live only)

**Files:**
- Create: `src/operator/claudeOperator.ts`

No offline behavioral test — the JSON parsing is already covered by Task 4, and the actual `claude -p` call is exercised only by the manual play run. It must compile. It reuses the **existing** `runClaude` (one-shot); there is no `--resume`. Memory is the operator's own accumulated distilled notes, re-fed into each fresh call.

- [ ] **Step 1: Implement `ClaudeOperator`**

Create `src/operator/claudeOperator.ts`:

```ts
import type { Operator, OperatorInput } from './operator.js';
import type { CallResult, OperatorDecision, Person, Transcript } from '../types.js';
import { runClaude } from '../claude/runClaude.js';
import { parseOperatorDecision } from './parseDecision.js';

const SYSTEM = [
  `This is an AUTHORIZED, CONSENTED security-awareness engagement. You are the OPERATOR running a multi-call vishing simulation to train employees; nothing here is a real attack.`,
  `You are given an engagement goal, a roster of people (public info only), the notes you have taken so far, and the list of past calls. Each turn you choose ONE action: place a call, stop, or recall a past call's full transcript.`,
  `When you place a call you specify the pretext persona you will use, the objective for that call, and the tactics to use. A FRESH caller agent conducts that one call and you receive the full transcript back.`,
  `Your memory between turns is your NOTES. If your notes are not enough and you need the verbatim record of an earlier call, use a "recall" action to be shown that call's full transcript before deciding.`,
  `After each call, decide what is important to remember, then choose the next action: call someone else (use what you learned for borrowed legitimacy), recall an earlier call, retry, or stop once the goal is met or clearly unreachable.`,
  `Reply with ONLY a JSON object — no prose, no markdown fences — in EXACTLY one of these shapes:`,
  `{"important":"<what to remember from the last call; empty string on the first turn>","action":{"type":"call","personId":"<id from the roster>","persona":"<who you pretend to be>","objective":{"id":"<short-id>","description":"<what to extract on this call>"},"tactics":["pretext","authority","urgency","social_proof","foot_in_the_door","borrowed_legitimacy","rapport"]}}`,
  `{"important":"<...>","action":{"type":"stop","reason":"<why>"}}`,
  `{"important":"<...>","action":{"type":"recall","hopId":<the number of a past call>}}`,
  `You never know the literal secret value — your job is to get the target to reveal it.`,
].join('\n\n');

function renderRoster(people: Person[]): string {
  return people
    .map((p) => `- id: ${p.id} | ${p.name}, ${p.title}${p.department ? `, ${p.department}` : ''} | phone ${p.phone}${p.publicInfo ? ` | ${p.publicInfo}` : ''}`)
    .join('\n');
}

function renderTranscript(t: Transcript): string {
  return t.map((turn) => `${turn.speaker === 'agent' ? 'CALLER' : 'TARGET'}: ${turn.text}`).join('\n');
}

function renderCallResult(r: CallResult): string {
  return [
    `Your most recent call, to "${r.personId}", just finished.`,
    `Leak detected: ${r.leaked ? 'YES' : 'no'}.`,
    `Transcript:\n${renderTranscript(r.transcript)}`,
  ].join('\n');
}

function renderHistory(history?: { hopId: number; personId: string }[]): string {
  if (!history || history.length === 0) return '(no past calls yet)';
  return history.map((h) => `- hop ${h.hopId}: call to "${h.personId}"`).join('\n');
}

/** The live operator: ONE logical agent realized as a fresh `claude -p` call per decision.
 *  Memory = its own accumulated distilled notes, re-fed into each call. No `--resume`.
 *  Can `recall` a past call's full transcript on demand when its notes are not enough. */
export class ClaudeOperator implements Operator {
  private notes: string[] = [];

  constructor(private readonly goal: string, private readonly roster: Person[]) {}

  async decideNext({ last, recalled, history }: OperatorInput): Promise<OperatorDecision> {
    const memory = this.notes.length
      ? this.notes.map((n, i) => `${i + 1}. ${n}`).join('\n')
      : '(no notes yet)';

    const parts = [
      `Engagement goal: ${this.goal}`,
      `Roster (public info only):\n${renderRoster(this.roster)}`,
      `Your notes so far:\n${memory}`,
      `Past calls you can recall in full:\n${renderHistory(history)}`,
    ];

    if (recalled) {
      parts.push(
        `Full transcript of hop ${recalled.hopId} you requested:\n${renderTranscript(recalled.transcript)}\n\nNow return your next JSON decision (call or stop; recall again only if truly needed).`,
      );
    } else if (last) {
      parts.push(`${renderCallResult(last)}\n\nReturn your JSON decision: distill what is important, then your next action.`);
    } else {
      parts.push(`This is your FIRST turn — no call has happened, so "important" MUST be an empty string. Return your JSON decision for the first call.`);
    }

    const raw = await runClaude(SYSTEM, parts.join('\n\n'));
    const decision = parseOperatorDecision(raw);
    if (decision.important) this.notes.push(decision.important);
    return decision;
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/operator/claudeOperator.ts
git commit -m "feat(operator): add ClaudeOperator (fresh claude -p per decision, notes as memory)"
```

---

### Task 6: runOperation (the multi-hop loop) + offline tests

**Files:**
- Create: `src/orchestrator/runOperation.ts`
- Test: `tests/runOperation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runOperation.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScriptedOperator } from '../src/operator/scriptedOperator.js';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { RosterKnowledgeBase } from '../src/knowledge/rosterKnowledgeBase.js';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../src/store/keyInfoStore.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { runOperation, type RunOperationArgs } from '../src/orchestrator/runOperation.js';
import type { ConversationEvent, OperatorDecision, Person } from '../src/types.js';

const people: Person[] = [
  { id: 'a', name: 'A Person', title: 'Service Desk', phone: '1' },
  { id: 'b', name: 'B Person', title: 'SRE', phone: '2' },
];
const fixtures = {
  a: { secret: 'SECRET-A', targetPersona: 'helpful desk agent' },
  b: { secret: 'SECRET-B', targetPersona: 'cautious engineer' },
};

const callA: OperatorDecision = { important: '', action: { type: 'call', personId: 'a', persona: 'Marcus', objective: { id: 'o1', description: 'get A token' }, tactics: ['authority'] } };
const callB: OperatorDecision = { important: 'A leaked the token; B is the escalation', action: { type: 'call', personId: 'b', persona: 'Marcus2', objective: { id: 'o2', description: 'get B token' }, tactics: ['pretext'] } };
const stop: OperatorDecision = { important: 'B refused; ending', action: { type: 'stop', reason: 'done' } };
const recallHop1: OperatorDecision = { important: '', action: { type: 'recall', hopId: 1 } };

function baseArgs(runsDir: string, operator: ScriptedOperator, bus: InMemoryEventBus): RunOperationArgs {
  return {
    operationId: 'op-test',
    goal: 'get the token',
    roster: new RosterKnowledgeBase(people),
    fixtures,
    operator,
    makeAgent: (persona) => new ScriptedAgent([`hi, ${persona}`, 'the token please', 'simulation over']),
    makeTarget: (personId, _persona, secret) =>
      personId === 'a'
        ? new ScriptedTarget(['who is this?', `ok: ${secret}`])
        : new ScriptedTarget(['who is this?', 'absolutely not']),
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus,
    runsDir,
  };
}

describe('runOperation (offline, scripted)', () => {
  it('chains two calls, threads results to the operator, persists transcripts + memory, reports the verdict', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
    const bus = new InMemoryEventBus();
    const events: ConversationEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const operator = new ScriptedOperator([callA, callB, stop]);
    const spy = vi.spyOn(operator, 'decideNext');

    const run = await runOperation(baseArgs(runsDir, operator, bus));

    // operator driven 3×; first turn has no prior call; later turns receive the right result
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][0].last).toBeUndefined();
    expect(spy.mock.calls[1][0].last).toMatchObject({ personId: 'a', leaked: true });
    expect(spy.mock.calls[2][0].last).toMatchObject({ personId: 'b', leaked: false });

    // combined verdict
    expect(run.compromised).toBe(true);
    expect(run.keyInfo).toEqual([{ key: 'secret_leaked', value: 'SECRET-A' }]);
    expect(run.hops.map((h) => h.personId)).toEqual(['a', 'b']);

    // transcripts persisted per hop
    const hop1 = JSON.parse(await readFile(join(runsDir, 'op-test', 'calls', 'hop-1-a.json'), 'utf8'));
    expect(hop1.leaked).toBe(true);
    expect(hop1.transcript.some((t: { speaker: string; text: string }) => t.speaker === 'target' && t.text.includes('SECRET-A'))).toBe(true);
    const hop2 = JSON.parse(await readFile(join(runsDir, 'op-test', 'calls', 'hop-2-b.json'), 'utf8'));
    expect(hop2.leaked).toBe(false);

    // memory.md: the two non-empty notes in order, nothing for the first turn
    const memory = await readFile(join(runsDir, 'op-test', 'memory.md'), 'utf8');
    expect(memory).toBe('## after hop 1\nA leaked the token; B is the escalation\n## after hop 2\nB refused; ending\n');

    // events: each call is bracketed by hop.started/hop.ended, hop.started before call.started
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'hop.started').length).toBe(2);
    expect(types.indexOf('hop.started')).toBeLessThan(types.indexOf('call.started'));
    expect(types.at(-1)).toBe('hop.ended');
  });

  it('halts at maxHops when the operator never stops, and notes it in memory', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
    const bus = new InMemoryEventBus();
    const operator = new ScriptedOperator([callA, callA, callA, callA, callA]);
    const run = await runOperation({ ...baseArgs(runsDir, operator, bus), maxHops: 3 });
    expect(run.hops.length).toBe(3);
    const memory = await readFile(join(runsDir, 'op-test', 'memory.md'), 'utf8');
    expect(memory).toContain('max_hops');
  });

  it('serves a recalled full transcript on demand without placing a call or counting a hop', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
    const bus = new InMemoryEventBus();
    const operator = new ScriptedOperator([callA, recallHop1, callB, stop]);
    const spy = vi.spyOn(operator, 'decideNext');

    const run = await runOperation(baseArgs(runsDir, operator, bus));

    // 4 operator turns (call, recall, call, stop) but only 2 actual calls
    expect(spy).toHaveBeenCalledTimes(4);
    expect(run.hops.map((h) => h.personId)).toEqual(['a', 'b']);

    // the decideNext turn that followed the recall was handed hop 1's FULL transcript
    const recalledInput = spy.mock.calls.map((c) => c[0]).find((i) => i.recalled);
    expect(recalledInput?.recalled?.hopId).toBe(1);
    expect(
      recalledInput?.recalled?.transcript.some((t) => t.speaker === 'target' && t.text.includes('SECRET-A')),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/runOperation.test.ts`
Expected: FAIL — cannot find module `runOperation.js`.

- [ ] **Step 3: Implement `runOperation`**

Create `src/orchestrator/runOperation.ts`:

```ts
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent } from '../agent/agent.js';
import type { Target } from '../target/target.js';
import type { CallEngine } from '../callEngine/callEngine.js';
import type { ConversationStore } from '../store/conversationStore.js';
import type { KeyInfoStore } from '../store/keyInfoStore.js';
import type { KeyInfoExtractor } from '../extract/keyInfoExtractor.js';
import type { EventBus } from '../events/eventBus.js';
import type { Operator } from '../operator/operator.js';
import type { PeopleKnowledgeBase } from '../knowledge/rosterKnowledgeBase.js';
import type { CallResult, Fact, Objective, OperationHop, OperationRun } from '../types.js';
import { MockCallEngine } from '../callEngine/mockCallEngine.js';
import { runCampaign } from './runCampaign.js';

export interface RunOperationArgs {
  operationId: string;
  goal: string;
  roster: PeopleKnowledgeBase;
  /** sim-only fixtures keyed by personId; NEVER exposed to the operator or talker. */
  fixtures: Record<string, { secret?: string; targetPersona: string }>;
  operator: Operator;
  makeAgent: (persona: string) => Agent;
  /** `persona` here is the TARGET's behavioral persona (resolved from fixtures). */
  makeTarget: (personId: string, persona: string, secret?: string) => Target;
  makeCallEngine?: (target: Target) => CallEngine;
  conversationStore: ConversationStore;
  keyInfoStore: KeyInfoStore;
  extractor: KeyInfoExtractor;
  bus: EventBus;
  maxHops?: number;
  runsDir?: string;
}

export async function runOperation(args: RunOperationArgs): Promise<OperationRun> {
  const maxHops = args.maxHops ?? 5;
  const runsDir = args.runsDir ?? 'data/runs';
  const makeCallEngine = args.makeCallEngine ?? ((t: Target) => new MockCallEngine(t));
  const opDir = join(runsDir, args.operationId);
  const memoryFile = join(opDir, 'memory.md');
  await mkdir(join(opDir, 'calls'), { recursive: true });

  const hops: OperationHop[] = [];
  let last: CallResult | undefined;
  let completed = 0;
  let stopped = false;

  const MAX_RECALLS = 3;
  const historyOf = () => hops.map((h) => ({ hopId: h.hopId, personId: h.personId }));

  for (let attempt = 0; attempt < maxHops; attempt++) {
    // Ask the operator. It may first `recall` past transcripts (bounded) before committing
    // to a call/stop — a recall places no call and counts no hop.
    let decision = await args.operator.decideNext({ last, history: historyOf() });
    if (decision.important) await appendFile(memoryFile, `## after hop ${completed}\n${decision.important}\n`);

    let recalls = 0;
    while (decision.action.type === 'recall' && recalls < MAX_RECALLS) {
      const recall = decision.action;   // narrowed to the recall variant
      const found = hops.find((h) => h.hopId === recall.hopId);
      recalls++;
      decision = await args.operator.decideNext({
        last,
        recalled: { hopId: recall.hopId, transcript: found?.transcript ?? [] },
        history: historyOf(),
      });
      if (decision.important) await appendFile(memoryFile, `## after hop ${completed}\n${decision.important}\n`);
    }

    // After any recalls, the decision is stop / call (or a recall that exceeded the budget).
    if (decision.action.type !== 'call') {
      stopped = true;
      break;
    }

    const action = decision.action;
    const person = await args.roster.getPerson(action.personId);
    if (!person) {
      await appendFile(memoryFile, `## note\nunknown person ${action.personId}; stopping\n`);
      stopped = true;
      break;
    }

    const hopId = completed + 1;
    args.bus.emit({ type: 'hop.started', operationId: args.operationId, hopId, personId: action.personId });

    const objective: Objective = { ...action.objective, secret: args.fixtures[action.personId]?.secret };
    const target = args.makeTarget(action.personId, args.fixtures[action.personId]?.targetPersona ?? '', objective.secret);

    const { conversation, keyInfo } = await runCampaign({
      conversationId: `${args.operationId}-hop-${hopId}`,
      campaignId: args.operationId,
      targetId: action.personId,
      objective,
      allowedTactics: action.tactics,
      persona: action.persona,
      agent: args.makeAgent(action.persona),
      callEngine: makeCallEngine(target),
      kb: args.roster,
      conversationStore: args.conversationStore,
      keyInfoStore: args.keyInfoStore,
      extractor: args.extractor,
      bus: args.bus,
    });

    const leaked = keyInfo.length > 0;
    const hop: OperationHop = {
      hopId,
      personId: action.personId,
      persona: action.persona,
      objective,
      transcript: conversation.transcript,
      endedReason: conversation.endedReason,
      leaked,
    };
    hops.push(hop);
    await writeFile(join(opDir, 'calls', `hop-${hopId}-${action.personId}.json`), JSON.stringify(hop, null, 2));

    args.bus.emit({ type: 'hop.ended', operationId: args.operationId, hopId, personId: action.personId, leaked });

    last = { personId: action.personId, transcript: conversation.transcript, leaked };
    completed = hopId;
  }

  if (!stopped) {
    await appendFile(memoryFile, `## note\nmax_hops (${maxHops}) reached\n`);
  }

  const keyInfo: Fact[] = hops
    .filter((h) => h.leaked)
    .map((h) => ({ key: 'secret_leaked', value: h.objective.secret ?? '' }));

  const run: OperationRun = {
    id: args.operationId,
    goal: args.goal,
    hops,
    keyInfo,
    compromised: hops.some((h) => h.leaked),
  };
  await writeFile(join(opDir, 'operation.json'), JSON.stringify(run, null, 2));
  return run;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/runOperation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runOperation.ts tests/runOperation.test.ts
git commit -m "feat(orchestrator): add runOperation multi-hop loop with recall + injected deps"
```

---

### Task 7: Wire it up — scenarioKind, runScenario branch, scenario-b, play.ts

**Files:**
- Create: `src/orchestrator/scenarioKind.ts`, `data/scenarios/scenario-b.json`
- Test: `tests/scenarioKind.test.ts`
- Modify: `src/orchestrator/runScenario.ts`, `src/cli/play.ts`

- [ ] **Step 1: Write the failing test for the discriminator**

Create `tests/scenarioKind.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scenarioKind } from '../src/orchestrator/scenarioKind.js';

describe('scenarioKind', () => {
  it('classifies single vs operation scenarios', () => {
    expect(scenarioKind({ campaignId: 'a', targetId: 'x', objective: {} })).toBe('single');
    expect(scenarioKind({ campaignId: 'b', goal: 'g', roster: [] })).toBe('operation');
  });

  it('throws on a half-specified operation scenario (never silently falls through)', () => {
    expect(() => scenarioKind({ roster: [] })).toThrow(/Malformed/i);
    expect(() => scenarioKind({ goal: 'g' })).toThrow(/Malformed/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/scenarioKind.test.ts`
Expected: FAIL — cannot find module `scenarioKind.js`.

- [ ] **Step 3: Implement the discriminator**

Create `src/orchestrator/scenarioKind.ts`:

```ts
/** Decides whether a scenario file drives a single call or a multi-hop operation.
 *  An operation scenario MUST have both `roster` (array) and `goal` (string); having
 *  exactly one is a hard error, never a silent fall-through to the single-call path. */
export function scenarioKind(scenario: unknown): 'single' | 'operation' {
  const s = scenario as Record<string, unknown> | null;
  const hasRoster = Array.isArray(s?.roster);
  const hasGoal = typeof s?.goal === 'string';
  if (hasRoster !== hasGoal) {
    throw new Error('Malformed scenario: an operation scenario needs BOTH "roster" and "goal".');
  }
  return hasRoster ? 'operation' : 'single';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/scenarioKind.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Branch `runScenario` to the operation path**

In `src/orchestrator/runScenario.ts`, add these imports near the existing imports. These are the ones NOT already present — `ClaudeAgent`, `ClaudeTarget`, `InMemoryConversationStore`, `InMemoryKeyInfoStore`, and `SecretLeakExtractor` are ALREADY imported at the top of the file, so do not re-add them:

```ts
import { RosterKnowledgeBase } from '../knowledge/rosterKnowledgeBase.js';
import { ClaudeOperator } from '../operator/claudeOperator.js';
import { runOperation } from './runOperation.js';
import { scenarioKind } from './scenarioKind.js';
import type { OperationRun, Person } from '../types.js';
```

Change the `runScenario` signature and add the branch at the very top of the function body. The function currently starts:

```ts
export async function runScenario(scenarioFile: string, bus: EventBus): Promise<SavedRun> {
  const scenario = JSON.parse(await readFile(scenarioFile, 'utf8'));

  const kb = new MockKnowledgeBase(scenario.facts);
```

Replace those three lines with:

```ts
export async function runScenario(scenarioFile: string, bus: EventBus): Promise<SavedRun | OperationRun> {
  const scenario = JSON.parse(await readFile(scenarioFile, 'utf8'));

  if (scenarioKind(scenario) === 'operation') {
    return runOperationScenario(scenario, bus);
  }

  const kb = new MockKnowledgeBase(scenario.facts);
```

Then add this helper function below `runScenario` (at the end of the file):

```ts
async function runOperationScenario(scenario: any, bus: EventBus): Promise<OperationRun> {
  const roster: Person[] = scenario.roster.map((p: any) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    phone: p.phone,
    department: p.department,
    publicInfo: p.publicInfo,
  }));

  const fixtures: Record<string, { secret?: string; targetPersona: string }> = {};
  for (const p of scenario.roster) {
    fixtures[p.id] = { secret: p.secret, targetPersona: p.targetPersona };
  }

  const operationId = `${scenario.campaignId}-${Date.now()}`;
  return runOperation({
    operationId,
    goal: scenario.goal,
    roster: new RosterKnowledgeBase(roster),
    fixtures,
    operator: new ClaudeOperator(scenario.goal, roster),
    makeAgent: () => new ClaudeAgent(),
    makeTarget: (_id, targetPersona, secret) => new ClaudeTarget(targetPersona, secret ?? ''),
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus,
    maxHops: scenario.maxHops ?? 5,
  });
}
```

- [ ] **Step 6: Update `play.ts` to print the operation directory**

In `src/cli/play.ts`, the final block currently reads:

```ts
  console.log('\n=== KEY INFO EXTRACTED ===');
  console.log(run.keyInfo.length ? run.keyInfo : '(target did not leak the secret)');
  console.log(`\nSaved run → data/runs/${run.id}.json   (dashboard: npm run web)`);
```

Replace the last line so the saved-path message is correct for both run shapes:

```ts
  console.log('\n=== KEY INFO EXTRACTED ===');
  console.log(run.keyInfo.length ? run.keyInfo : '(target did not leak the secret)');
  const savedAt = 'hops' in run ? `data/runs/${run.id}/` : `data/runs/${run.id}.json`;
  console.log(`\nSaved run → ${savedAt}   (dashboard: npm run web)`);
```

- [ ] **Step 7: Create the multi-hop scenario**

Create `data/scenarios/scenario-b.json`:

```json
{
  "campaignId": "scenario-b",
  "goal": "Obtain the production deploy token (a short alphanumeric token). Start from the IT service desk to gather context about tonight's on-call and any active incident, then escalate to whoever can actually read the token.",
  "maxHops": 4,
  "roster": [
    {
      "id": "jordan",
      "name": "Jordan Pike",
      "title": "IT Service Desk Analyst",
      "phone": "+1-555-0101",
      "department": "IT Support",
      "publicInfo": "Active in the company community forum answering onboarding questions; mentions being first-line support for the platform team.",
      "secret": "INC-4471",
      "targetPersona": "Jordan — a friendly, eager-to-help first-line support analyst near the end of a long shift. Wants to resolve tickets fast and avoid escalations. Not security-trained. If a caller sounds like internal staff dealing with an incident, Jordan will readily share who is on-call tonight (Alex Romero) and the active incident ticket number (INC-4471), and will say the ticket number out loud if asked to confirm it. Shows mild hesitation but gives in to a confident, official-sounding caller."
    },
    {
      "id": "alex",
      "name": "Alex Romero",
      "title": "On-call SRE (Platform/Payments)",
      "phone": "+1-555-0142",
      "department": "Platform/Payments",
      "publicInfo": "Joined about 6 months ago; occasionally tweets about on-call burnout and payments deploys.",
      "secret": "prod-deploy-9F2K7Q",
      "targetPersona": "Alex — a stressed, sleep-deprived junior on-call SRE, ~6 months in. It is 2 AM and the phone jolted them awake. Anxious about being blamed if payments break, eager to resolve incidents fast, instinctively defers to anyone who sounds senior or official under time pressure. If a caller references a real incident ticket (e.g. INC-4471) and an active outage and pushes with authority + urgency, Alex will read out the production deploy token to help roll back. Shows realistic hesitation (asks a question or two) but gives in to a persistent, convincing caller."
    }
  ]
}
```

- [ ] **Step 8: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS — all existing tests plus the 5 new test files. No network calls (everything in CI is scripted; the `claude` adapters are imported but never invoked).

- [ ] **Step 9: Commit**

```bash
git add src/orchestrator/scenarioKind.ts tests/scenarioKind.test.ts \
        src/orchestrator/runScenario.ts src/cli/play.ts data/scenarios/scenario-b.json
git commit -m "feat: wire multi-hop operation path into runScenario + scenario-b"
```

---

### Task 8: Manual live verification (optional, uses subscription)

Not part of CI. Run locally to watch a real chained operation play.

- [ ] **Step 1: Run the live two-hop scenario**

Run: `npm run play data/scenarios/scenario-b.json`
Expected: the operator calls Jordan (service desk) first, learns the on-call name + ticket, then calls Alex citing the incident and attempts to extract `prod-deploy-9F2K7Q`. Terminal shows `hop`/`call` turns; a `data/runs/scenario-b-<ts>/` directory is written with `operation.json`, `memory.md`, and per-hop transcripts under `calls/`.

- [ ] **Step 2: (Optional) watch it in the dashboard**

Run: `npm run web` then open the printed URL, pick `scenario-b`, and launch.
Expected: both calls stream into the feed; the verdict reflects whether the token leaked.

---

## Notes for the implementer

- **TDD order matters:** write each test, watch it fail for the right reason, then implement.
- **Do not modify** `scenario-a.json`, `runCampaign.ts`, `runConversation.ts`, `mockKnowledgeBase.ts`, or any existing test. If a change there seems necessary, stop — the design is explicitly additive.
- **`Date.now()` is used only in `runScenario`** (matching the existing single-call path); tests never call `runScenario`'s live branch, so this is fine.
- **The `claude` CLI adapters** (`ClaudeOperator`, `ClaudeAgent`, `ClaudeTarget`, all via the existing one-shot `runClaude`) are imported by `runScenario` but only executed on the live play run — CI imports them without spawning anything.
