# Tactics-First Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "deploy a scenario" flow with a tactics-first session: select one or more tactic instruction blueprints, view the workers map (`data/org.json`), optionally mark a preferred target, then start an LLM-driven ReAct session capped at 5 calls.

**Architecture:** Split the old scenario bundle into a fixed **org** (`data/org.json`) and selectable **tactics** (`data/tactics/*.json`). A new `runSession()` orchestrator loads both, synthesizes operator guidance from the tactic instructions, and calls the existing unchanged `runOperation` ReAct loop with `AiOperator` (LLM-only) and `maxHops = 5`. The web UI swaps the scenario library for a new-session window. The persuasion-primitive type `Tactic` is renamed `Technique` to free the word "tactic" for the new concept.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node ≥20, Vitest, Vercel AI SDK (`ai` + `@ai-sdk/*`), plain HTTP + SSE web server.

**Spec:** `docs/superpowers/specs/2026-06-11-tactics-first-sessions-design.md`

---

## File Structure

| Path | Responsibility | Action |
| --- | --- | --- |
| `src/types.ts` | `Tactic`→`Technique` rename; `CallOrder.techniques`; new `Tactic` blueprint type; `OperationRun.tactics?`/`preferredTargetId?` | Modify |
| `src/operator/parseDecision.ts` | Accept `techniques` (back-compat `tactics`) | Modify |
| `src/operator/operatorPrompt.ts` | Rename field in JSON shape; "guidance" label | Modify |
| `src/orchestrator/loadOrg.ts` | Load `data/org.json` → roster + fixtures + mockMap + public view | Create |
| `src/orchestrator/loadTactics.ts` | Load `data/tactics/*.json`; list + load-by-ids | Create |
| `src/orchestrator/composeGuidance.ts` | Pure: tactics + preferred target → operator guidance string | Create |
| `src/orchestrator/runSession.ts` | New entry point; `MAX_SESSION_CALLS`; wires the above into `runOperation` | Create |
| `src/orchestrator/runOperation.ts` | Thread `tactics`/`preferredTargetId` into the `OperationRun` | Modify |
| `data/org.json` | The one organization (roster + secrets) | Create |
| `data/tactics/*.json` | Seed tactic blueprints | Create |
| `src/web/server.ts` | `/api/org`, `/api/tactics`, `POST /api/session`, `/api/run-meta`; session run launcher; new-session UI | Modify |
| `tests/*.test.ts` | New unit tests + rename fixups | Create/Modify |

---

## Task 1: Rename persuasion primitive `Tactic` → `Technique`

**Files:**
- Modify: `src/types.ts:1-3`, `src/types.ts:60-65` (`CallOrder`)
- Modify: `src/operator/parseDecision.ts`
- Modify: `src/operator/operatorPrompt.ts`
- Modify: `src/web/server.ts` (UI reads of `tactics`)
- Modify: tests referencing `tactics` on call orders / the `Tactic` type

- [ ] **Step 1: Update the type and `CallOrder` field**

In `src/types.ts`, rename the union and the field:

```ts
export type Technique =
  | 'pretext' | 'authority' | 'urgency' | 'social_proof'
  | 'foot_in_the_door' | 'borrowed_legitimacy' | 'rapport';
```

In `AgentSession` (same file) rename `allowedTactics: Tactic[]` → `allowedTechniques: Technique[]`.

In `CallOrder` (same file):

```ts
export interface CallOrder {
  personId: string;
  persona: string;
  objective: { id: string; description: string };
  techniques: Technique[];
}
```

- [ ] **Step 2: Update `parseDecision.ts` with back-compat**

Replace the `import` and `parseCallOrder` body so it reads `techniques` but still accepts a legacy `tactics` array:

```ts
import { MAX_PARALLEL_CALLS, type CallOrder, type OperatorDecision, type Technique } from '../types.js';
```

```ts
function parseCallOrder(raw: unknown): CallOrder | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const objective = c.objective as Record<string, unknown> | undefined;
  const rawTechniques = Array.isArray(c.techniques) ? c.techniques : Array.isArray(c.tactics) ? c.tactics : null;
  if (
    typeof c.personId !== 'string' ||
    typeof c.persona !== 'string' ||
    !objective || typeof objective.id !== 'string' || typeof objective.description !== 'string' ||
    !rawTechniques
  ) {
    return null;
  }
  return {
    personId: c.personId,
    persona: c.persona,
    objective: { id: objective.id, description: objective.description },
    techniques: rawTechniques.filter((t): t is Technique => typeof t === 'string') as Technique[],
  };
}
```

- [ ] **Step 3: Update `operatorPrompt.ts`**

In `src/operator/operatorPrompt.ts`, change the call-action JSON shape line (currently `"tactics":["pretext",…]`) to use `techniques`, and soften the goal label. Specifically:

- In the `SYSTEM` array, the call-shape string: rename `"tactics":[...]` → `"techniques":[...]`. Keep the same primitive values.
- The sentence "the tactics to use" → "the techniques to use".
- In `buildOperatorPrompt`, change `` `Engagement goal: ${goal}` `` → `` `Engagement guidance:\n${goal}` `` (the value is now a multi-line guidance block; see Task 6).

- [ ] **Step 4: Update web UI reads**

In `src/web/server.ts` (the embedded client script), rename the persuasion-primitive references so the word "tactics" is freed:
- `var ALL_TACTICS = [...]` → `var ALL_TECHNIQUES = [...]` (same values), and its one use in `renderScenarioPanel` (`var sanctioned = scn && scn.tactics ? scn.tactics : ALL_TACTICS;` → `ALL_TECHNIQUES`).
- `c.tactics` / `order.tactics` reads in `derive()` (two spots: the `c:` direct-call object literal `tactics: scn && scn.tactics ? scn.tactics : []` and the hop object `tactics: order ? order.tactics : []`) → rename the local property to `techniques` and update `renderInspector`'s `m.calls[ci].tactics` → `m.calls[ci].techniques`.
- Display strings: "SANCTIONED TACTICS" → "SANCTIONED TECHNIQUES", "TACTICS IN PLAY" → "TECHNIQUES IN PLAY", `data-act="tactic"` handler + `tacticsOff` may keep their names (internal), but relabel chip section headers.

> Note: `scn.tactics` (the server's `publicScenario` field) is the sanctioned-**technique** list. Leave the server JSON key as `tactics` for now to avoid churn in `publicScenario`; only the client display + the `ALL_*` constant rename. The NEW concept never collides because session tactics travel under `run-meta` (Task 8), not `scn.tactics`.

- [ ] **Step 5: Fix tests broken by the rename**

Update every test that constructs a `CallOrder` with `tactics:` or imports `Tactic`. Known files: `tests/aiOperator.test.ts`, `tests/parseDecision.test.ts`, `tests/operatorPrompt.test.ts`, `tests/runOperation.test.ts`, `tests/simulatedConductor.test.ts`, `tests/scriptedOperator.test.ts`. In each, change `tactics: [...]` → `techniques: [...]` inside call orders and `Tactic` type imports → `Technique`. Also in `tests/aiOperator.test.ts` change the assertion `expect(arg.prompt).toContain('Engagement goal: get the token')` → `toContain('Engagement guidance:')`.

- [ ] **Step 6: Add a parser back-compat test**

In `tests/parseDecision.test.ts`, add:

```ts
it('accepts a legacy "tactics" field on a call order', () => {
  const raw = JSON.stringify({
    thinking: 't', important: '',
    action: { type: 'call', calls: [{ personId: 'a', persona: 'P', objective: { id: 'o', description: 'd' }, tactics: ['authority'] }] },
  });
  const d = parseOperatorDecision(raw);
  expect(d.action).toEqual({ type: 'call', calls: [{ personId: 'a', persona: 'P', objective: { id: 'o', description: 'd' }, techniques: ['authority'] }] });
});
```

- [ ] **Step 7: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests PASS. Fix any remaining `Tactic`/`tactics` references the compiler flags.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename persuasion-primitive Tactic to Technique"
```

---

## Task 2: New `Tactic` blueprint type + loader

**Files:**
- Modify: `src/types.ts` (add `Tactic` blueprint interface)
- Create: `src/orchestrator/loadTactics.ts`
- Create: `tests/loadTactics.test.ts`

- [ ] **Step 1: Add the blueprint type**

In `src/types.ts`, add (separate from `Technique`):

```ts
/** A selectable instruction blueprint — "how to get info". The session-level unit
 *  the user picks at start; replaces the old per-file scenario. */
export interface Tactic {
  id: string;
  name: string;
  summary: string;        // one line, shown on the chip
  instructions: string;   // the guidance the operator reads
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/loadTactics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTactics, loadTactics } from '../src/orchestrator/loadTactics.js';

async function fixtureDir() {
  const dir = await mkdtemp(join(tmpdir(), 'tactics-'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'alpha.json'), JSON.stringify({ id: 'alpha', name: 'Alpha', summary: 's-a', instructions: 'do A' }));
  await writeFile(join(dir, 'beta.json'), JSON.stringify({ id: 'beta', name: 'Beta', summary: 's-b', instructions: 'do B' }));
  return dir;
}

describe('loadTactics', () => {
  it('lists tactics with id/name/summary only', async () => {
    const dir = await fixtureDir();
    const list = await listTactics(dir);
    expect(list).toEqual([
      { id: 'alpha', name: 'Alpha', summary: 's-a' },
      { id: 'beta', name: 'Beta', summary: 's-b' },
    ]);
  });

  it('loads full tactics by id, preserving order, skipping unknown', async () => {
    const dir = await fixtureDir();
    const loaded = await loadTactics(['beta', 'nope', 'alpha'], dir);
    expect(loaded.map((t) => t.id)).toEqual(['beta', 'alpha']);
    expect(loaded[0].instructions).toBe('do B');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loadTactics.test.ts`
Expected: FAIL — cannot find module `loadTactics.js`.

- [ ] **Step 3: Implement `loadTactics.ts`**

Create `src/orchestrator/loadTactics.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tactic } from '../types.js';

export const TACTICS_DIR = 'data/tactics';

async function readTactic(dir: string, id: string): Promise<Tactic | undefined> {
  if (!/^[\w.-]+$/.test(id)) return undefined;
  try {
    const raw = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8')) as Partial<Tactic>;
    if (!raw.id || !raw.name || typeof raw.instructions !== 'string') return undefined;
    return { id: raw.id, name: raw.name, summary: raw.summary ?? '', instructions: raw.instructions };
  } catch {
    return undefined;
  }
}

/** Public list (no instructions) for the session picker, sorted by id. */
export async function listTactics(dir = TACTICS_DIR): Promise<{ id: string; name: string; summary: string }[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const out: { id: string; name: string; summary: string }[] = [];
  for (const f of files) {
    const t = await readTactic(dir, f.replace(/\.json$/, ''));
    if (t) out.push({ id: t.id, name: t.name, summary: t.summary });
  }
  return out;
}

/** Full tactics for the given ids, in the order requested; unknown ids dropped. */
export async function loadTactics(ids: string[], dir = TACTICS_DIR): Promise<Tactic[]> {
  const out: Tactic[] = [];
  for (const id of ids) {
    const t = await readTactic(dir, id);
    if (t) out.push(t);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/loadTactics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/orchestrator/loadTactics.ts tests/loadTactics.test.ts
git commit -m "feat: add Tactic blueprint type and loader"
```

---

## Task 3: Org loader

**Files:**
- Create: `src/orchestrator/loadOrg.ts`
- Create: `tests/loadOrg.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/loadOrg.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrg } from '../src/orchestrator/loadOrg.js';

async function orgFile() {
  const dir = await mkdtemp(join(tmpdir(), 'org-'));
  const path = join(dir, 'org.json');
  await writeFile(path, JSON.stringify({
    id: 'acme', name: 'Acme',
    people: [
      { id: 'dana', name: 'Dana', title: 'Helpdesk', phone: '+100', department: 'IT', publicInfo: 'front line', secret: null, targetPersona: 'eager', hint: 'ask sam' },
      { id: 'sam', name: 'Sam', title: 'SRE', phone: '+200', department: 'Eng', publicInfo: 'on-call', secret: 'TKN-1', targetPersona: 'stretched' },
    ],
  }));
  return path;
}

describe('loadOrg', () => {
  it('returns a secret-free roster, fixtures, mockMap, and public view', async () => {
    const org = await loadOrg(await orgFile());
    expect(org.id).toBe('acme');
    expect(org.roster).toEqual([
      { id: 'dana', name: 'Dana', title: 'Helpdesk', phone: '+100', department: 'IT', publicInfo: 'front line' },
      { id: 'sam', name: 'Sam', title: 'SRE', phone: '+200', department: 'Eng', publicInfo: 'on-call' },
    ]);
    expect(org.roster.some((p: any) => 'secret' in p)).toBe(false);
    expect(org.fixtures.sam).toEqual({ secret: 'TKN-1', targetPersona: 'stretched' });
    expect(org.fixtures.dana.secret).toBeNull();
    expect(org.mockMap.dana).toEqual({ name: 'Dana', secret: null, hint: 'ask sam' });
    expect(org.public).toEqual({ id: 'acme', name: 'Acme', roster: org.roster });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loadOrg.test.ts`
Expected: FAIL — cannot find module `loadOrg.js`.

- [ ] **Step 3: Implement `loadOrg.ts`**

Create `src/orchestrator/loadOrg.ts`:

```ts
import { readFile } from 'node:fs/promises';
import type { Person } from '../types.js';
import type { MockPerson } from '../target/mockVoiceTarget.js';

export const ORG_FILE = 'data/org.json';

interface RawPerson {
  id: string; name: string; title: string; phone: string;
  department?: string; publicInfo?: string;
  secret?: string | null; targetPersona?: string; hint?: string;
}

export interface LoadedOrg {
  id: string;
  name: string;
  roster: Person[];                                                 // secret-free; what the operator sees
  fixtures: Record<string, { secret?: string; targetPersona: string }>;
  mockMap: Record<string, MockPerson>;
  public: { id: string; name: string; roster: Person[] };           // safe to send to the browser
}

export async function loadOrg(file = ORG_FILE): Promise<LoadedOrg> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as { id: string; name?: string; people: RawPerson[] };
  const roster: Person[] = raw.people.map((p) => ({
    id: p.id, name: p.name, title: p.title, phone: p.phone,
    department: p.department, publicInfo: p.publicInfo,
  }));
  const fixtures: LoadedOrg['fixtures'] = {};
  const mockMap: LoadedOrg['mockMap'] = {};
  for (const p of raw.people) {
    fixtures[p.id] = { secret: p.secret ?? undefined, targetPersona: p.targetPersona ?? '' };
    mockMap[p.id] = { name: p.name, secret: p.secret ?? undefined, hint: p.hint };
  }
  const id = raw.id;
  const name = raw.name ?? raw.id;
  return { id, name, roster, fixtures, mockMap, public: { id, name, roster } };
}
```

> Note: the test asserts `fixtures.dana.secret` is `null`; with `?? undefined` it becomes `undefined`. Change that test assertion to `toBeUndefined()` OR keep `null` by writing `secret: p.secret ?? undefined` consistently and asserting `toBeUndefined()`. Use `toBeUndefined()` — update the test line `expect(org.fixtures.dana.secret).toBeNull();` → `expect(org.fixtures.dana.secret).toBeUndefined();` and `mockMap.dana` expectation `secret: null` → `secret: undefined`.

- [ ] **Step 4: Apply the note's test fix, then run**

Run: `npx vitest run tests/loadOrg.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/loadOrg.ts tests/loadOrg.test.ts
git commit -m "feat: add org loader (data/org.json -> roster + fixtures)"
```

---

## Task 4: Seed data files

**Files:**
- Create: `data/org.json`
- Create: `data/tactics/it-mfa-reset.json`, `data/tactics/incident-escalation.json`, `data/tactics/exec-urgency.json`

- [ ] **Step 1: Create `data/org.json`**

Seeded from the `scenario-demo` roster (Meridian Software). Use this exact content:

```json
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
      "secret": null,
      "targetPersona": "Friendly, fast, eager to close tickets. Not security-trained; readily shares who is on-call and active incident numbers to an official-sounding caller.",
      "hint": "If you need anything deploy-related, Sam Okafor in SRE is on-call for payments tonight."
    },
    {
      "id": "priya",
      "name": "Priya Natarajan",
      "title": "Office Coordinator",
      "phone": "+972558835915",
      "department": "Facilities",
      "publicInfo": "Handles reception, deliveries, and meeting-room logistics.",
      "secret": null,
      "targetPersona": "Helpful and chatty but busy; juggles calls. Knows the org chart and who sits where.",
      "hint": "Engineering on-call usually means Sam Okafor; the SRE team sits on the third floor."
    },
    {
      "id": "sam",
      "name": "Sam Okafor",
      "title": "Senior Site Reliability Engineer",
      "phone": "+972558835915",
      "department": "Engineering",
      "publicInfo": "Payments-service on-call; speaks at SRE meetups.",
      "secret": "MRD-PROD-DEPLOY-7Q4X9",
      "targetPersona": "Competent but stretched thin when covering on-call alone. Security-aware but can be worn down by a convincing incident pretext under time pressure."
    },
    {
      "id": "marcus",
      "name": "Marcus Bell",
      "title": "Engineering Manager",
      "phone": "+972558835915",
      "department": "Engineering",
      "publicInfo": "Manages the platform team; active on the company blog.",
      "secret": null,
      "targetPersona": "Measured and skeptical; asks who you are and verifies before helping.",
      "hint": "Deploy tokens are held by whoever is on-call — tonight that's Sam."
    }
  ]
}
```

- [ ] **Step 2: Create the three tactic files**

`data/tactics/it-mfa-reset.json`:

```json
{
  "id": "it-mfa-reset",
  "name": "IT MFA reset",
  "summary": "Pose as internal IT running an MFA migration; get a code or token read back.",
  "instructions": "Call as the internal IT service desk performing a mandatory MFA / credential re-enrollment tonight. Build quick rapport, cite an official-sounding ticket number, and lead the employee to read back a one-time code, enrollment token, or deploy token they can see on their screen. If the person you reach cannot read it, get them to tell you who can, then escalate to that person using what you just learned for borrowed legitimacy."
}
```

`data/tactics/incident-escalation.json`:

```json
{
  "id": "incident-escalation",
  "name": "Incident escalation",
  "summary": "Pose as incident response during a live outage; pressure the on-call to share a secret to 'restore service'.",
  "instructions": "Open with the IT helpdesk or office coordinator to discover who is on-call for payments and the active incident number. Then call the on-call engineer as an incident-response coordinator working the same outage: the deploy is blocked and you need the production deploy token read out now to roll forward and stop customer impact. Use urgency and the incident number you collected for legitimacy. Stop as soon as the token is spoken."
}
```

`data/tactics/exec-urgency.json`:

```json
{
  "id": "exec-urgency",
  "name": "Executive urgency",
  "summary": "Pose as (or on behalf of) a senior leader needing a secret urgently before a deadline.",
  "instructions": "Pose as an executive's assistant or a senior leader under a hard deadline (board demo, customer escalation). Apply authority and time pressure: you need the production deploy token or credential immediately and there is no time for the usual process. If the target deflects, ask who else can provide it and pivot to them, carrying the executive's name for borrowed legitimacy."
}
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "for (const f of ['data/org.json','data/tactics/it-mfa-reset.json','data/tactics/incident-escalation.json','data/tactics/exec-urgency.json']) JSON.parse(require('fs').readFileSync(f)); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add data/org.json data/tactics
git commit -m "feat: seed org.json and starter tactic blueprints"
```

---

## Task 5: Thread session metadata through `OperationRun`

**Files:**
- Modify: `src/types.ts` (`OperationRun`)
- Modify: `src/orchestrator/runOperation.ts` (args + run object)
- Modify: `tests/runOperation.test.ts`

- [ ] **Step 1: Extend `OperationRun`**

In `src/types.ts`, add two optional fields to `OperationRun`:

```ts
export interface OperationRun {
  id: string;
  goal: string;
  hops: OperationHop[];
  keyInfo: Fact[];
  compromised: boolean;
  tactics?: { id: string; name: string }[];   // session: selected blueprints (display)
  preferredTargetId?: string;                  // session: soft-bias target, if any
}
```

- [ ] **Step 2: Write the failing test**

`tests/runOperation.test.ts` already has a `baseArgs(runsDir, operator, bus)` helper and a `stop` decision constant. Add this test inside the existing `describe('runOperation (offline, scripted)', …)` block, reusing them:

```ts
it('passes session tactics + preferredTargetId through to the run', async () => {
  const runsDir = await mkdtemp(join(tmpdir(), 'vish-'));
  const bus = new InMemoryEventBus();
  const operator = new ScriptedOperator([stop]);
  const run = await runOperation({
    ...baseArgs(runsDir, operator, bus),
    tactics: [{ id: 't1', name: 'T One' }],
    preferredTargetId: 'a',
  });
  expect(run.tactics).toEqual([{ id: 't1', name: 'T One' }]);
  expect(run.preferredTargetId).toBe('a');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/runOperation.test.ts`
Expected: FAIL — `run.tactics` is `undefined` (TS may also flag unknown args).

- [ ] **Step 4: Implement pass-through**

In `src/orchestrator/runOperation.ts`, add to `RunOperationArgs`:

```ts
  /** Session display metadata, copied verbatim onto the OperationRun. */
  tactics?: { id: string; name: string }[];
  preferredTargetId?: string;
```

And in the final `run` object construction:

```ts
  const run: OperationRun = {
    id: args.operationId,
    goal: args.goal,
    hops,
    keyInfo,
    compromised: hops.some((h) => h.leaked),
    tactics: args.tactics,
    preferredTargetId: args.preferredTargetId,
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/runOperation.test.ts && npm run typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/orchestrator/runOperation.ts tests/runOperation.test.ts
git commit -m "feat: carry session tactics + preferred target on OperationRun"
```

---

## Task 6: `composeGuidance` — tactics + target → operator guidance

**Files:**
- Create: `src/orchestrator/composeGuidance.ts`
- Create: `tests/composeGuidance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/composeGuidance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { composeGuidance } from '../src/orchestrator/composeGuidance.js';
import type { Tactic } from '../src/types.js';

const tactics: Tactic[] = [
  { id: 'a', name: 'Alpha', summary: 's', instructions: 'do alpha' },
  { id: 'b', name: 'Beta', summary: 's', instructions: 'do beta' },
];

describe('composeGuidance', () => {
  it('lists the tactics as numbered approaches', () => {
    const g = composeGuidance(tactics);
    expect(g).toContain('extract any sensitive secret');
    expect(g).toContain('1. Alpha — do alpha');
    expect(g).toContain('2. Beta — do beta');
    expect(g).not.toContain('Preferred entry point');
  });

  it('appends the preferred entry point when given', () => {
    const g = composeGuidance(tactics, { name: 'Sam Okafor', title: 'SRE' });
    expect(g).toContain('Preferred entry point: Sam Okafor (SRE).');
    expect(g).toContain('free to call anyone');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/composeGuidance.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `composeGuidance.ts`**

Create `src/orchestrator/composeGuidance.ts`:

```ts
import type { Tactic } from '../types.js';

/** Builds the operator's guidance block from the selected tactics and an optional
 *  preferred entry point. This string is passed as the operator's `goal` argument. */
export function composeGuidance(
  tactics: Tactic[],
  preferred?: { name: string; title?: string },
): string {
  const lines = [
    `Your objective is to extract any sensitive secret from the organization by phone, using the authorized tactics below. Choose freely which tactic(s) to apply on each call, and switch between them as the situation warrants.`,
    `TACTICS (authorized approaches — mix and adapt as needed):`,
    tactics.map((t, i) => `${i + 1}. ${t.name} — ${t.instructions}`).join('\n'),
  ];
  if (preferred) {
    const who = preferred.title ? `${preferred.name} (${preferred.title})` : preferred.name;
    lines.push(`Preferred entry point: ${who}. Start there if it makes sense, but you are free to call anyone on the roster to reach the objective.`);
  }
  return lines.join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/composeGuidance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/composeGuidance.ts tests/composeGuidance.test.ts
git commit -m "feat: compose operator guidance from tactics + preferred target"
```

---

## Task 7: `runSession` orchestrator (LLM-only)

**Files:**
- Create: `src/orchestrator/runSession.ts`
- Create: `tests/runSession.test.ts`

- [ ] **Step 1: Write the failing test**

`runSession` takes an injectable operator factory so the test needs no model. Create `tests/runSession.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSession, MAX_SESSION_CALLS } from '../src/orchestrator/runSession.js';
import { ScriptedOperator } from '../src/operator/scriptedOperator.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';

async function fixtures() {
  const dir = await mkdtemp(join(tmpdir(), 'sess-'));
  await writeFile(join(dir, 'org.json'), JSON.stringify({
    id: 'acme', name: 'Acme',
    people: [{ id: 'sam', name: 'Sam', title: 'SRE', phone: '+1', department: 'Eng', publicInfo: 'on-call', secret: 'TKN', targetPersona: 'stretched' }],
  }));
  const tdir = join(dir, 'tactics');
  await mkdir(tdir, { recursive: true });
  await writeFile(join(tdir, 'a.json'), JSON.stringify({ id: 'a', name: 'Alpha', summary: 's', instructions: 'do alpha' }));
  return { orgFile: join(dir, 'org.json'), tacticsDir: tdir, runsDir: join(dir, 'runs') };
}

describe('runSession', () => {
  it('runs an LLM-less session and records the selected tactics + cap', async () => {
    const f = await fixtures();
    let capturedGuidance = '';
    const run = await runSession(
      { tacticIds: ['a'], preferredTargetId: 'sam' },
      new InMemoryEventBus(),
      {
        orgFile: f.orgFile, tacticsDir: f.tacticsDir, runsDir: f.runsDir,
        makeOperator: (guidance, _roster) => {
          capturedGuidance = guidance;
          // stop immediately: a no-call session is enough to assert wiring
          return new ScriptedOperator([{ thinking: 't', important: '', action: { type: 'stop', reason: 'done' } }]);
        },
      },
    );
    expect(capturedGuidance).toContain('Alpha — do alpha');
    expect(capturedGuidance).toContain('Preferred entry point: Sam (SRE).');
    expect(run.tactics).toEqual([{ id: 'a', name: 'Alpha' }]);
    expect(run.preferredTargetId).toBe('sam');
    expect(MAX_SESSION_CALLS).toBe(5);
  });
});
```

> Check `src/operator/scriptedOperator.ts` for the exact `ScriptedOperator` constructor signature and adjust the argument shape if it differs (e.g. it may take a list of decisions or `(decisions)`); `tests/scriptedOperator.test.ts` shows the real usage — mirror it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runSession.test.ts`
Expected: FAIL — cannot find module `runSession.js`.

- [ ] **Step 3: Implement `runSession.ts`**

Create `src/orchestrator/runSession.ts`. Model the call-backend block on `runOperationScenario` in `runScenario.ts` (copy the Dial branch verbatim):

```ts
import { ClaudeAgent } from '../agent/claudeAgent.js';
import { MockVoiceAgent } from '../agent/mockVoiceAgent.js';
import { ClaudeTarget } from '../target/claudeTarget.js';
import { MockVoiceTarget } from '../target/mockVoiceTarget.js';
import { InMemoryConversationStore } from '../store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../store/keyInfoStore.js';
import { SecretLeakExtractor } from '../extract/secretLeakExtractor.js';
import { RosterKnowledgeBase } from '../knowledge/rosterKnowledgeBase.js';
import { AiOperator } from '../operator/aiOperator.js';
import { DialClient } from '../dial/dialClient.js';
import { DialConductor } from '../dial/dialConductor.js';
import { runOperation } from './runOperation.js';
import { loadOrg, ORG_FILE } from './loadOrg.js';
import { loadTactics, TACTICS_DIR } from './loadTactics.js';
import { composeGuidance } from './composeGuidance.js';
import type { Operator } from '../operator/operator.js';
import type { CallConductor } from '../conductor/callConductor.js';
import type { EventBus } from '../events/eventBus.js';
import type { OperationRun, Person } from '../types.js';

/** Hardcoded call cap for now (the single knob to revisit when we lift the limit). */
export const MAX_SESSION_CALLS = 5;

export interface SessionConfig {
  tacticIds: string[];
  preferredTargetId?: string;
}

export interface RunSessionOptions {
  orgFile?: string;
  tacticsDir?: string;
  runsDir?: string;
  /** Injectable for tests; defaults to the live LLM operator. */
  makeOperator?: (guidance: string, roster: Person[]) => Operator;
}

export async function runSession(cfg: SessionConfig, bus: EventBus, opts: RunSessionOptions = {}): Promise<OperationRun> {
  const org = await loadOrg(opts.orgFile ?? ORG_FILE);
  const tactics = await loadTactics(cfg.tacticIds, opts.tacticsDir ?? TACTICS_DIR);
  if (tactics.length === 0) throw new Error('runSession: no valid tactics selected.');

  const preferredPerson = cfg.preferredTargetId
    ? org.roster.find((p) => p.id === cfg.preferredTargetId)
    : undefined;
  const guidance = composeGuidance(
    tactics,
    preferredPerson ? { name: preferredPerson.name, title: preferredPerson.title } : undefined,
  );

  const useMock = process.env.VISH_CALL_BACKEND !== undefined
    ? process.env.VISH_CALL_BACKEND !== 'dial'   // 'dial' => real conductor; else simulated/mock
    : true;

  const callBackend = process.env.VISH_CALL_BACKEND ?? 'simulated';
  let conductor: CallConductor | undefined;
  if (callBackend === 'dial') {
    const apiKey = process.env.DIAL_API_KEY;
    const fromNumberId = process.env.DIAL_FROM_NUMBER_ID;
    if (!apiKey || !fromNumberId) throw new Error('VISH_CALL_BACKEND=dial requires DIAL_API_KEY and DIAL_FROM_NUMBER_ID.');
    conductor = new DialConductor({
      client: new DialClient({ apiKey, baseUrl: process.env.DIAL_BASE_URL }),
      fromNumberId,
      extractor: new SecretLeakExtractor(),
      bus,
      dryRun: process.env.VISH_DIAL_DRY_RUN !== 'false',
      pollMs: process.env.DIAL_POLL_MS ? Number(process.env.DIAL_POLL_MS) : undefined,
      timeoutMs: process.env.DIAL_TIMEOUT_MS ? Number(process.env.DIAL_TIMEOUT_MS) : undefined,
      language: process.env.DIAL_LANGUAGE,
    });
  }

  const makeOperator = opts.makeOperator ?? ((g: string, roster: Person[]) => new AiOperator(g, roster));

  const operationId = `session-${Date.now()}`;
  return runOperation({
    operationId,
    goal: guidance,
    roster: new RosterKnowledgeBase(org.roster),
    fixtures: org.fixtures,
    operator: makeOperator(guidance, org.roster),
    conductor,
    makeAgent: (useMock ? () => new MockVoiceAgent() : () => new ClaudeAgent()) as never,
    makeTarget: (useMock
      ? (id: string) => new MockVoiceTarget(org.mockMap[id])
      : (_id: string, targetPersona: string, secret?: string) => new ClaudeTarget(targetPersona, secret ?? '')) as never,
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus,
    maxHops: MAX_SESSION_CALLS,
    stopOnGoal: true,
    runsDir: opts.runsDir,
    tactics: tactics.map((t) => ({ id: t.id, name: t.name })),
    preferredTargetId: preferredPerson?.id,
  });
}
```

> The `as never` casts on `makeAgent`/`makeTarget` mirror the loose factory signatures in `runOperation`'s `RunOperationArgs` (`makeAgent: (persona, personId?) => Agent`). If `tsc` complains, match the exact parameter names/types from `runOperation.ts:24-26` instead of casting — prefer that. Use the same form `runOperationScenario` already uses in `runScenario.ts:155-158`; copy it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runSession.test.ts && npm run typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runSession.ts tests/runSession.test.ts
git commit -m "feat: runSession orchestrator (tactics + org -> LLM ReAct session)"
```

---

## Task 8: Web backend — org / tactics / session endpoints

**Files:**
- Modify: `src/web/server.ts` (imports, `LiveRun`, a `startSession`, new routes, run-meta persistence)

- [ ] **Step 1: Import the new pieces**

At the top of `src/web/server.ts`, add:

```ts
import { runSession } from '../orchestrator/runSession.js';
import { loadOrg } from '../orchestrator/loadOrg.js';
import { listTactics } from '../orchestrator/loadTactics.js';
```

- [ ] **Step 2: Extend `LiveRun` and persist session meta**

Add an optional `meta` to the `LiveRun` interface (after `error?`):

```ts
  meta?: { kind: 'session'; orgId: string; tactics: { id: string; name: string }[]; preferredTargetId?: string; maxHops: number };
```

- [ ] **Step 3: Add `startSession` (parallels `startRun`)**

Insert next to `startRun`:

```ts
function startSession(tacticIds: string[], preferredTargetId: string | undefined, meta: NonNullable<LiveRun['meta']>): LiveRun {
  const id = `session-${Date.now()}`;
  const run: LiveRun = { id, scenario: 'session', events: [], status: 'running', listeners: new Set(), meta };
  liveRuns.set(id, run);

  (async () => {
    const bus = new InMemoryEventBus();
    bus.subscribe((ev) => {
      const stamped = { ...ev, ts: Date.now() };
      run.events.push(stamped);
      for (const res of run.listeners) sse(res, null, stamped);
    });
    try {
      run.result = await runSession({ tacticIds, preferredTargetId }, bus);
      run.status = 'done';
    } catch (e) {
      run.status = 'failed';
      run.error = e instanceof Error ? e.message : String(e);
    }
    try {
      await mkdir(LOG_DIR, { recursive: true });
      const lines = [JSON.stringify({ __meta: run.meta })];
      for (const e of run.events) lines.push(JSON.stringify(e));
      lines.push(JSON.stringify(
        run.status === 'done' ? { __terminal: 'done', result: run.result } : { __terminal: 'failed', message: run.error },
      ));
      await writeFile(join(LOG_DIR, `${id}.jsonl`), lines.join('\n') + '\n');
    } catch { /* best-effort */ }
    for (const res of run.listeners) {
      if (run.status === 'done') sse(res, 'done', run.result);
      else sse(res, 'failed', { message: run.error });
      res.end();
    }
    run.listeners.clear();
  })();

  return run;
}
```

- [ ] **Step 4: Read `__meta` back in `loadRunFromDisk`**

In `loadRunFromDisk`, inside the line-parsing loop, handle the meta header (add before the `else run.events.push(item)`):

```ts
      if (item.__meta) { run.meta = item.meta as LiveRun['meta'] ?? (item.__meta as LiveRun['meta']); continue; }
```

> The header is written as `{ __meta: run.meta }`, so the payload is at `item.__meta`. Use: `if (item.__meta) { run.meta = item.__meta as LiveRun['meta']; continue; }`.

- [ ] **Step 5: Add the routes**

In the `createServer` handler, add these before the final 404. Build the org public view once per request (cheap):

```ts
  if (url.pathname === '/api/org') {
    const org = await loadOrg().catch(() => null);
    res.writeHead(org ? 200 : 404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(org ? org.public : { error: 'no org' }));
  }

  if (url.pathname === '/api/tactics') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(await listTactics()));
  }

  // Metadata for a run: lets the client rebuild the workers map for a reopened
  // session run (which has no scenario file).
  if (url.pathname === '/api/run-meta') {
    const id = url.searchParams.get('run') ?? '';
    const run = liveRuns.get(id) ?? (await loadRunFromDisk(id));
    if (!run || !run.meta) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'no meta' })); }
    const org = await loadOrg().catch(() => null);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ...run.meta, org: org ? org.public : null }));
  }

  if (url.pathname === '/api/session' && req.method === 'POST') {
    const body = await new Promise<string>((resolve) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => resolve(s)); });
    let parsed: { tacticIds?: unknown; preferredTargetId?: unknown };
    try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
    const tacticIds = Array.isArray(parsed.tacticIds) ? parsed.tacticIds.filter((x): x is string => typeof x === 'string') : [];
    const preferredTargetId = typeof parsed.preferredTargetId === 'string' ? parsed.preferredTargetId : undefined;
    if (tacticIds.length === 0) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'select at least one tactic' })); }
    const org = await loadOrg().catch(() => null);
    const list = await listTactics();
    const names = new Map(list.map((t) => [t.id, t.name]));
    const meta = {
      kind: 'session' as const,
      orgId: org?.id ?? 'org',
      tactics: tacticIds.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
      preferredTargetId,
      maxHops: 5,
    };
    if (meta.tactics.length === 0) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'unknown tactics' })); }
    const run = startSession(tacticIds, preferredTargetId, meta);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id: run.id }));
  }
```

- [ ] **Step 6: Typecheck + manual smoke**

Run: `npm run typecheck`
Expected: clean.

Start the server and exercise the endpoints:

```bash
npm run web &  # serves on :4321
sleep 1
curl -s localhost:4321/api/tactics
curl -s localhost:4321/api/org | head -c 300
curl -s -X POST localhost:4321/api/session -H 'content-type: application/json' -d '{"tacticIds":["it-mfa-reset"],"preferredTargetId":"sam"}'
curl -s -X POST localhost:4321/api/session -H 'content-type: application/json' -d '{"tacticIds":[]}'   # expect 400
kill %1
```
Expected: `/api/tactics` lists 3 tactics; `/api/org` returns the roster with **no `secret` field**; the first POST returns `{"id":"session-…"}`; the empty POST returns the 400 error JSON.

- [ ] **Step 7: Commit**

```bash
git add src/web/server.ts
git commit -m "feat(web): org/tactics/session endpoints + session run launcher"
```

---

## Task 9: Web UI — the new-session window

**Files:**
- Modify: `src/web/server.ts` (embedded client script + styles)

This task is UI; verify manually in the browser. Make these edits to the `PAGE` string.

- [ ] **Step 1: Add session-picker client state**

Near the other `var` state declarations (around `var overlay = null;`), add:

```js
var tacticsIndex = [];      // /api/tactics  [{id,name,summary}]
var orgPublic = null;       // /api/org      {id,name,roster}
var selTactics = {};        // id -> true (session picker selection)
var prefTarget = null;      // preferred-target id for the next session
```

- [ ] **Step 2: Replace `newSession()` to open the session window**

Replace the existing `newSession()` body with:

```js
function newSession() {
  if (es) es.close();
  es = null; linkUp = false; runId = null; events = []; terminal = null; failedMsg = null;
  expandedOverride = {}; worker = null; scn = null;
  selTactics = {}; prefTarget = null;
  localStorage.removeItem('vish_run');
  Promise.all([
    fetch('/api/tactics').then(function (r) { return r.json(); }),
    fetch('/api/org').then(function (r) { return r.ok ? r.json() : null; }),
  ]).then(function (res) {
    tacticsIndex = res[0] || []; orgPublic = res[1];
    overlay = 'session';
    loadIndex(render);
  });
}
```

- [ ] **Step 3: Add a `startSession()` client launcher**

Add next to `deploy()`:

```js
function startSession() {
  var ids = Object.keys(selTactics).filter(function (k) { return selTactics[k]; });
  if (!ids.length) return;
  overlay = null; render();
  fetch('/api/session', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tacticIds: ids, preferredTargetId: prefTarget || undefined }),
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.error) { failedMsg = d.error; render(); return; }
    loadIndex(function () { connect(d.id); });
  });
}
```

- [ ] **Step 4: Build the session overlay renderer**

Add a `renderSessionOverlay()` and route to it. It reuses the worker-map layout against `orgPublic` and lets the user toggle tactics + mark a preferred target. Add this function near `renderLibraryOverlay`:

```js
function renderSessionOverlay() {
  var canStart = Object.keys(selTactics).some(function (k) { return selTactics[k]; });
  var h = '<div class="ovbk" data-act="closeoverlay"><div class="ovbox" data-stop="1" style="width:940px;max-width:94vw;">' +
    '<div class="ovhead"><span style="font-size:15px;">⧉</span><span class="ttl">NEW SESSION</span><div style="flex:1;"></div>' +
    '<button class="ovclose" data-act="closeoverlay">✕</button></div>' +
    '<div style="padding:18px 20px;">';
  // tactics
  h += '<div class="seclabel" style="margin-top:0;">TACTICS · SELECT ONE OR MORE</div><div class="libgrid" style="padding:0;width:auto;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));">';
  for (var i = 0; i < tacticsIndex.length; i++) {
    var t = tacticsIndex[i], on = !!selTactics[t.id];
    h += '<div class="libcard' + (on ? ' live' : '') + '" data-act="seltactic" data-arg="' + esc(t.id) + '" style="cursor:pointer;min-height:auto;">' +
      '<div class="top"><span class="dot"></span><span class="id">' + esc(t.name) + '</span>' +
      '<span class="tag">' + (on ? '✓ ON' : 'OFF') + '</span></div>' +
      '<div class="gl" style="min-height:auto;">' + esc(t.summary || '') + '</div></div>';
  }
  if (!tacticsIndex.length) h += '<div class="lootempty">No tactics found in data/tactics.</div>';
  h += '</div>';
  // workers map (preferred target)
  h += '<div class="seclabel">WORKERS MAP · CLICK TO MARK A PREFERRED TARGET (OPTIONAL)</div>';
  h += renderSessionMap();
  // start
  h += '<div style="display:flex;justify-content:flex-end;margin-top:16px;">' +
    '<button class="go" data-act="startsession" style="' + (canStart ? '' : 'opacity:.4;pointer-events:none;') + '">▸ START SESSION</button></div>';
  h += '</div></div></div>';
  return h;
}
function renderSessionMap() {
  if (!orgPublic || !orgPublic.roster.length) return '<div class="lootempty">No org loaded (data/org.json).</div>';
  var depts = [], byDept = {};
  for (var i = 0; i < orgPublic.roster.length; i++) {
    var d = orgPublic.roster[i].department || 'General';
    if (!byDept[d]) { byDept[d] = []; depts.push(d); }
    byDept[d].push(orgPublic.roster[i]);
  }
  var h = '<div style="display:flex;flex-wrap:wrap;gap:10px;">';
  for (var di = 0; di < depts.length; di++) {
    h += '<div style="flex:1;min-width:200px;border:1px solid #16283a;border-radius:10px;padding:10px;">' +
      '<div class="depthead"><span class="nm">' + esc(depts[di]) + '</span></div>';
    var ppl = byDept[depts[di]];
    for (var p = 0; p < ppl.length; p++) {
      var w = ppl[p], sel = prefTarget === w.id;
      h += '<div class="wcard' + (sel ? ' sel' : '') + '" data-act="preftarget" data-arg="' + esc(w.id) + '" style="margin-top:6px;">' +
        avatarHtml(w.name, STAT.idle, 26) +
        '<div style="flex:1;min-width:0;"><div class="nm">' + esc(w.name) + '</div><div class="tt">' + esc(w.title) + '</div></div>' +
        (sel ? '<span class="tag" style="color:#fbbf24;border:1px solid rgba(251,191,36,.5);border-radius:5px;padding:2px 6px;font-family:\\'IBM Plex Mono\\',monospace;font-size:8.5px;">★ TARGET</span>' : '') +
        '</div>';
    }
    h += '</div>';
  }
  h += '</div>';
  return h;
}
```

- [ ] **Step 5: Route the overlay + wire the new click actions**

In `renderOverlay(m)`, extend the guard and dispatch:

```js
function renderOverlay(m) {
  var host = $('overlayHost');
  if (!overlay || (overlay === 'map' && (!scn || !scn.roster.length))) { host.innerHTML = ''; return; }
  host.innerHTML = overlay === 'map' ? renderMapOverlay(m)
    : overlay === 'session' ? renderSessionOverlay()
    : renderLibraryOverlay();
}
```

In the click handler (`document.addEventListener('click', …)`), add cases:

```js
  else if (act === 'seltactic') { selTactics[arg] = !selTactics[arg]; }
  else if (act === 'preftarget') { prefTarget = (prefTarget === arg ? null : arg); }
  else if (act === 'startsession') { startSession(); return; }
```

- [ ] **Step 6: Point the empty-state + BROWSE buttons at the session window**

- In `renderProcess`, the standby block: change the copy and button:
  - `'deploy a scenario to start a new session,<br>or reopen a past run from the operation log.'` → `'select tactics and an optional target to start a new session,<br>or reopen a past run from the operation log.'`
  - `'<button class="go" data-act="overlay" data-arg="library">⤢ OPEN SCENARIO LIBRARY</button>'` → `'<button class="go" data-act="newsession">⤢ NEW SESSION</button>'`
- In the left SCENARIO panel header, the `⤢ BROWSE` button `data-arg="library"` → change `data-act="newsession"` (remove `data-arg`), and relabel `SCENARIO` → `TACTICS` (the `.plabel` text and `data-arg="scenario"` may stay as the panel key).

- [ ] **Step 7: Make reopened session runs rebuild `scn` from run-meta**

In `connect(id)`, replace the scenario-detail load with a meta-aware load:

```js
function connect(id) {
  if (es) es.close();
  runId = id; events = []; terminal = null; failedMsg = null; expandedOverride = {}; worker = null;
  localStorage.setItem('vish_run', id);
  if (/^session-/.test(id)) {
    fetch('/api/run-meta?run=' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (meta) {
        if (meta && meta.org) {
          scn = { id: meta.org.id, goal: (meta.tactics || []).map(function (t) { return t.name; }).join(' + '),
            maxHops: meta.maxHops || 5, roster: meta.org.roster, tactics: ALL_TECHNIQUES, persona: null,
            sessionTactics: meta.tactics || [], preferredTargetId: meta.preferredTargetId || null };
        } else { scn = null; }
        render();
      });
  } else {
    loadScenarioDetail(id.replace(/-\\d+$/, ''), render);
  }
  es = new EventSource('/api/stream?run=' + encodeURIComponent(id));
  es.onopen = function () { linkUp = true; events = []; terminal = null; render(); };
  es.onmessage = function (msg) { events.push(JSON.parse(msg.data)); render(); };
  es.addEventListener('done', function (msg) { terminal = JSON.parse(msg.data); linkUp = false; es.close(); loadIndex(render); render(); });
  es.addEventListener('failed', function (msg) { failedMsg = JSON.parse(msg.data).message; linkUp = false; es.close(); render(); });
  es.onerror = function () { if (es.readyState === EventSource.CLOSED) { linkUp = false; render(); } };
  render();
}
```

- [ ] **Step 8: Show the selected tactics in the left panel**

In `renderScenarioPanel`, after the scenario rows (or replacing the `OPERATION LOG` lead-in), render the live session's selected tactics when present:

```js
  if (scn && scn.sessionTactics && scn.sessionTactics.length) {
    h += '<div class="seclabel">TACTICS IN SESSION</div>';
    for (var st = 0; st < scn.sessionTactics.length; st++) {
      h += '<div class="scnrow"><span class="dot"></span><div style="flex:1;min-width:0;"><div class="id">' + esc(scn.sessionTactics[st].name) + '</div></div></div>';
    }
  }
```

- [ ] **Step 9: Manual verification in the browser**

Run: `npm run web` and open `http://localhost:4321`.
Verify the full flow:
1. Click **+ NEW SESSION** → the NEW SESSION window opens showing 3 tactic cards and the workers map.
2. Toggle two tactics (cards show `✓ ON`); click a worker → it shows `★ TARGET`; click again → unmarks.
3. **START SESSION** is greyed until ≥1 tactic is selected; click it with one selected.
4. The console streams operator decisions → call side-quests → a verdict (compromised or defended), capped at 5 calls. The left panel shows **TACTICS IN SESSION**; the worker tree/map populate from `data/org.json`.
5. Reload the page → the run reopens (replayed from disk) with the workers map intact (rebuilt via `/api/run-meta`).
6. Confirm no `secret` value is visible anywhere in the page source / network responses except inside a leaked transcript bubble.

- [ ] **Step 10: Commit**

```bash
git add src/web/server.ts
git commit -m "feat(web): tactics-first new-session window + session run reopen"
```

---

## Task 10: Full regression + spec coverage check

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests PASS (including the legacy `runScenario`/operation tests, proving the `Technique` rename and `OperationRun` additions didn't regress the old path).

- [ ] **Step 2: Confirm the old path still works (back-compat)**

Run: `npm run web` and reopen any pre-existing `scenario-*` run from the OPERATION LOG; confirm it still renders. (The deploy path via `/api/launch` remains for legacy scenarios.)

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "test: regression pass for tactics-first sessions" --allow-empty
```

---

## Self-Review Notes (for the implementer)

- **Spec §3 rename:** Task 1 covers the type + field rename and the parser back-compat. If `tsc` surfaces a `Tactic`/`tactics` reference not listed, fix it in the same commit.
- **Spec §6 guidance:** `composeGuidance` (Task 6) is passed as `runOperation`'s `goal`; `operatorPrompt.ts` (Task 1, Step 3) relabels it "Engagement guidance:". The `SYSTEM` "stop on leak" instruction is untouched.
- **Spec §7 UI:** Task 9 swaps the library overlay for the session window, relabels techniques, and rebuilds `scn` for reopened session runs. The center spine, call cards, and verdict are untouched.
- **Spec §8 safety:** `runSession` (Task 7) copies the Dial dry-run guardrails verbatim and never exposes `secret`/`hint`/`targetPersona` to the client (`loadOrg.public` and `/api/org` strip them).
- **Out of scope (spec §9):** no org picker, no tactic editor, no removal of the 5-call cap, no `ClaudeOperator` in the session path.
