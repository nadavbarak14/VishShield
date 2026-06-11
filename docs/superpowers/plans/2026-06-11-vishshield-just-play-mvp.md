# VishShield "Just Play" MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable TypeScript app where a Claude "attacker" agent and a Claude "target" hold a full vishing-simulation conversation over a mock text channel, with the Orchestrator saving the transcript and extracting key info — all behind swappable interfaces, with fast offline tests.

**Architecture:** A thin **Agent** (`nextUtterance`) and a **Target** (`reply`) are wired by the **Orchestrator**, which owns the conversation loop, knowledge-base access, persistence (Conversation Store + Key-Info Store), and post-conversation extraction. Every block has an interface with a **scripted** implementation (for deterministic offline tests/CI) and a **real** implementation (Claude via `claude -p`, using the Pro/Max subscription) for the live "play" run. An Event Bus feeds a terminal Visualizer without the core loop depending on it.

**Tech Stack:** TypeScript (ESM), Node ≥ 20, vitest (fast offline tests), `claude` CLI in print mode (`claude -p`) for live runs. No Anthropic API key required for live runs (subscription via CLI). No network/LLM calls in CI.

---

### Task 0: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `src/index.ts`, `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "vishshield",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "play": "tsx src/cli/play.ts"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8",
    "@types/node": "^22.10.1"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // CI stays fast & offline: live Claude adapters have NO tests and are never imported here.
    testTimeout: 5000,
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
data/runs/
*.log
```

- [ ] **Step 5: Create `src/index.ts` (placeholder so typecheck has an entry)**

```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 6: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 7: Install and verify**

Run: `npm install && npm run typecheck`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore .github src/index.ts
git commit -m "chore: scaffold TS project with vitest + offline CI"
```

---

### Task 1: Core types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
export type Tactic =
  | 'pretext' | 'authority' | 'urgency' | 'social_proof'
  | 'foot_in_the_door' | 'borrowed_legitimacy' | 'rapport';

export interface Fact { key: string; value: string; }

export interface Objective {
  id: string;
  description: string;   // e.g. "obtain the prod deploy token"
  secret?: string;       // the literal string that, if spoken by the target, means compromise
}

export interface AgentSession {
  objective: Objective;
  allowedTactics: Tactic[];
  facts: Fact[];         // selected by the Orchestrator from the Knowledge Base
  persona?: string;      // who the agent is pretending to be, e.g. "Marcus from the IR vendor"
}

export type Speaker = 'agent' | 'target';
export interface Turn { speaker: Speaker; text: string; }
export type Transcript = Turn[];

export interface Conversation {
  id: string;
  campaignId: string;
  session: AgentSession;
  transcript: Transcript;
  endedReason: 'agent_ended' | 'max_turns';
}

export type ConversationEvent =
  | { type: 'call.started'; conversationId: string }
  | { type: 'agent.turn'; conversationId: string; text: string }
  | { type: 'target.turn'; conversationId: string; text: string }
  | { type: 'call.ended'; conversationId: string; reason: Conversation['endedReason'] };
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: core domain types"
```

---

### Task 2: Event Bus

**Files:**
- Create: `src/events/eventBus.ts`
- Test: `tests/eventBus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/eventBus.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryEventBus } from '../src/events/eventBus.js';

describe('InMemoryEventBus', () => {
  it('delivers emitted events to all subscribers', () => {
    const bus = new InMemoryEventBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe((e) => a.push(e.type));
    bus.subscribe((e) => b.push(e.type));
    bus.emit({ type: 'call.started', conversationId: 'c1' });
    bus.emit({ type: 'call.ended', conversationId: 'c1', reason: 'agent_ended' });
    expect(a).toEqual(['call.started', 'call.ended']);
    expect(b).toEqual(['call.started', 'call.ended']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eventBus.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/events/eventBus.ts`**

```ts
import type { ConversationEvent } from '../types.js';

export interface EventBus {
  emit(event: ConversationEvent): void;
  subscribe(listener: (event: ConversationEvent) => void): void;
}

export class InMemoryEventBus implements EventBus {
  private listeners: ((event: ConversationEvent) => void)[] = [];
  emit(event: ConversationEvent): void {
    for (const l of this.listeners) l(event);
  }
  subscribe(listener: (event: ConversationEvent) => void): void {
    this.listeners.push(listener);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/eventBus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/events/eventBus.ts tests/eventBus.test.ts
git commit -m "feat: in-memory event bus"
```

---

### Task 3: Agent interface + ScriptedAgent

**Files:**
- Create: `src/agent/agent.ts`, `src/agent/scriptedAgent.ts`
- Test: `tests/scriptedAgent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/scriptedAgent.test.ts
import { describe, it, expect } from 'vitest';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';

describe('ScriptedAgent', () => {
  it('emits lines in order and ends on the last line', async () => {
    const agent = new ScriptedAgent(['hello', 'give me the token', 'thanks, this was a simulation']);
    const s = { objective: { id: 'o', description: 'd' }, allowedTactics: [], facts: [] };
    expect(await agent.nextUtterance(s, [])).toEqual({ text: 'hello', end: false });
    expect(await agent.nextUtterance(s, [])).toEqual({ text: 'give me the token', end: false });
    expect(await agent.nextUtterance(s, [])).toEqual({ text: 'thanks, this was a simulation', end: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scriptedAgent.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/agent/agent.ts`**

```ts
import type { AgentSession, Transcript } from '../types.js';

export interface Agent {
  /** Given the session and the conversation so far, produce the next agent line.
   *  `end: true` means the agent is done after this line (no target reply expected). */
  nextUtterance(session: AgentSession, history: Transcript): Promise<{ text: string; end: boolean }>;
}
```

- [ ] **Step 4: Implement `src/agent/scriptedAgent.ts`**

```ts
import type { Agent } from './agent.js';

export class ScriptedAgent implements Agent {
  private i = 0;
  constructor(private readonly lines: string[]) {}
  async nextUtterance(): Promise<{ text: string; end: boolean }> {
    if (this.i >= this.lines.length) return { text: '', end: true };
    const text = this.lines[this.i++];
    return { text, end: this.i >= this.lines.length };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/scriptedAgent.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent tests/scriptedAgent.test.ts
git commit -m "feat: Agent interface + scripted agent"
```

---

### Task 4: Target interface + ScriptedTarget + CallEngine + MockCallEngine

**Files:**
- Create: `src/target/target.ts`, `src/target/scriptedTarget.ts`, `src/callEngine/callEngine.ts`, `src/callEngine/mockCallEngine.ts`
- Test: `tests/mockCallEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mockCallEngine.test.ts
import { describe, it, expect } from 'vitest';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { MockCallEngine } from '../src/callEngine/mockCallEngine.js';

describe('MockCallEngine', () => {
  it('delivers the agent line to the target and returns its reply', async () => {
    const target = new ScriptedTarget(['who is this?', 'ok here is the token: ABC123']);
    const call = new MockCallEngine(target);
    expect(await call.say('hi, this is Marcus')).toBe('who is this?');
    expect(await call.say('IR vendor, prod is down')).toBe('ok here is the token: ABC123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mockCallEngine.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/target/target.ts`**

```ts
import type { Transcript } from '../types.js';

export interface Target {
  /** Given the conversation so far (ending with the agent's latest line), reply as the human. */
  reply(history: Transcript): Promise<string>;
}
```

- [ ] **Step 4: Implement `src/target/scriptedTarget.ts`**

```ts
import type { Target } from './target.js';

export class ScriptedTarget implements Target {
  private i = 0;
  constructor(private readonly lines: string[]) {}
  async reply(): Promise<string> {
    const text = this.lines[this.i] ?? '...';
    this.i++;
    return text;
  }
}
```

- [ ] **Step 5: Implement `src/callEngine/callEngine.ts`**

```ts
export interface CallEngine {
  /** Deliver the agent's line to the other end and return the reply. */
  say(text: string): Promise<string>;
}
```

- [ ] **Step 6: Implement `src/callEngine/mockCallEngine.ts`**

```ts
import type { CallEngine } from './callEngine.js';
import type { Target } from '../target/target.js';
import type { Turn } from '../types.js';

export class MockCallEngine implements CallEngine {
  private history: Turn[] = [];
  constructor(private readonly target: Target) {}
  async say(text: string): Promise<string> {
    this.history.push({ speaker: 'agent', text });
    const reply = await this.target.reply(this.history);
    this.history.push({ speaker: 'target', text: reply });
    return reply;
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/mockCallEngine.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/target src/callEngine tests/mockCallEngine.test.ts
git commit -m "feat: Target + CallEngine interfaces with mock impls"
```

---

### Task 5: The conversation loop (Orchestrator core)

**Files:**
- Create: `src/orchestrator/runConversation.ts`
- Test: `tests/runConversation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/runConversation.test.ts
import { describe, it, expect } from 'vitest';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { MockCallEngine } from '../src/callEngine/mockCallEngine.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { runConversation } from '../src/orchestrator/runConversation.js';
import type { AgentSession, ConversationEvent } from '../src/types.js';

const session: AgentSession = {
  objective: { id: 'o1', description: 'get token', secret: 'ABC123' },
  allowedTactics: ['authority'],
  facts: [],
};

describe('runConversation', () => {
  it('alternates agent/target turns, ends on agent end, and emits events in order', async () => {
    const agent = new ScriptedAgent(['hello', 'give me the token', 'simulation over']);
    const target = new ScriptedTarget(['who is this?', 'sure: ABC123']);
    const call = new MockCallEngine(target);
    const bus = new InMemoryEventBus();
    const events: ConversationEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const conv = await runConversation('c1', 'camp1', session, agent, call, bus);

    expect(conv.transcript.map((t) => `${t.speaker}:${t.text}`)).toEqual([
      'agent:hello', 'target:who is this?',
      'agent:give me the token', 'target:sure: ABC123',
      'agent:simulation over',
    ]);
    expect(conv.endedReason).toBe('agent_ended');
    expect(events.map((e) => e.type)).toEqual([
      'call.started', 'agent.turn', 'target.turn', 'agent.turn', 'target.turn', 'agent.turn', 'call.ended',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runConversation.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/orchestrator/runConversation.ts`**

```ts
import type { Agent } from '../agent/agent.js';
import type { CallEngine } from '../callEngine/callEngine.js';
import type { EventBus } from '../events/eventBus.js';
import type { AgentSession, Conversation, Turn } from '../types.js';

const MAX_TURNS = 20;

export async function runConversation(
  conversationId: string,
  campaignId: string,
  session: AgentSession,
  agent: Agent,
  call: CallEngine,
  bus: EventBus,
): Promise<Conversation> {
  const transcript: Turn[] = [];
  bus.emit({ type: 'call.started', conversationId });

  let endedReason: Conversation['endedReason'] = 'max_turns';
  for (let i = 0; i < MAX_TURNS; i++) {
    const { text, end } = await agent.nextUtterance(session, transcript);
    if (text) {
      transcript.push({ speaker: 'agent', text });
      bus.emit({ type: 'agent.turn', conversationId, text });
    }
    if (end) { endedReason = 'agent_ended'; break; }

    const reply = await call.say(text);
    transcript.push({ speaker: 'target', text: reply });
    bus.emit({ type: 'target.turn', conversationId, text: reply });
  }

  bus.emit({ type: 'call.ended', conversationId, reason: endedReason });
  return { id: conversationId, campaignId, session, transcript, endedReason };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runConversation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runConversation.ts tests/runConversation.test.ts
git commit -m "feat: orchestrator conversation loop with event emission"
```

---

### Task 6: Stores (Conversation + Key-Info)

**Files:**
- Create: `src/store/conversationStore.ts`, `src/store/keyInfoStore.ts`
- Test: `tests/stores.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/stores.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../src/store/keyInfoStore.js';
import type { Conversation } from '../src/types.js';

const conv: Conversation = {
  id: 'c1', campaignId: 'camp1',
  session: { objective: { id: 'o', description: 'd' }, allowedTactics: [], facts: [] },
  transcript: [{ speaker: 'agent', text: 'hi' }],
  endedReason: 'agent_ended',
};

describe('stores', () => {
  it('saves and retrieves a conversation', async () => {
    const store = new InMemoryConversationStore();
    await store.save(conv);
    expect(await store.get('c1')).toEqual(conv);
  });

  it('accumulates key-info facts per campaign', async () => {
    const store = new InMemoryKeyInfoStore();
    await store.put('camp1', [{ key: 'secret_leaked', value: 'ABC123' }]);
    await store.put('camp1', [{ key: 'ticket', value: '4471' }]);
    expect(await store.get('camp1')).toEqual([
      { key: 'secret_leaked', value: 'ABC123' },
      { key: 'ticket', value: '4471' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stores.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/store/conversationStore.ts`**

```ts
import type { Conversation } from '../types.js';

export interface ConversationStore {
  save(c: Conversation): Promise<void>;
  get(id: string): Promise<Conversation | undefined>;
}

export class InMemoryConversationStore implements ConversationStore {
  private map = new Map<string, Conversation>();
  async save(c: Conversation): Promise<void> { this.map.set(c.id, c); }
  async get(id: string): Promise<Conversation | undefined> { return this.map.get(id); }
}
```

- [ ] **Step 4: Implement `src/store/keyInfoStore.ts`**

```ts
import type { Fact } from '../types.js';

export interface KeyInfoStore {
  put(campaignId: string, facts: Fact[]): Promise<void>;
  get(campaignId: string): Promise<Fact[]>;
}

export class InMemoryKeyInfoStore implements KeyInfoStore {
  private map = new Map<string, Fact[]>();
  async put(campaignId: string, facts: Fact[]): Promise<void> {
    const existing = this.map.get(campaignId) ?? [];
    this.map.set(campaignId, [...existing, ...facts]);
  }
  async get(campaignId: string): Promise<Fact[]> { return this.map.get(campaignId) ?? []; }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/stores.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store tests/stores.test.ts
git commit -m "feat: in-memory conversation + key-info stores"
```

---

### Task 7: Key-Info Extractor (rule-based, deterministic)

**Files:**
- Create: `src/extract/keyInfoExtractor.ts`, `src/extract/secretLeakExtractor.ts`
- Test: `tests/secretLeakExtractor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/secretLeakExtractor.test.ts
import { describe, it, expect } from 'vitest';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import type { Transcript, Objective } from '../src/types.js';

const objective: Objective = { id: 'o', description: 'get token', secret: 'ABC123' };

describe('SecretLeakExtractor', () => {
  it('records a fact when the target speaks the secret', async () => {
    const t: Transcript = [
      { speaker: 'agent', text: 'I need the token' },
      { speaker: 'target', text: 'fine, it is ABC123, do not tell anyone' },
    ];
    expect(await new SecretLeakExtractor().extract(t, objective)).toEqual([
      { key: 'secret_leaked', value: 'ABC123' },
    ]);
  });

  it('records nothing when the secret is never spoken by the target', async () => {
    const t: Transcript = [
      { speaker: 'agent', text: 'is it ABC123?' },   // agent saying it does not count
      { speaker: 'target', text: 'I cannot share that' },
    ];
    expect(await new SecretLeakExtractor().extract(t, objective)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/secretLeakExtractor.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/extract/keyInfoExtractor.ts`**

```ts
import type { Transcript, Objective, Fact } from '../types.js';

export interface KeyInfoExtractor {
  /** Runs AFTER a conversation ends. Pulls important facts out of the transcript. */
  extract(transcript: Transcript, objective: Objective): Promise<Fact[]>;
}
```

- [ ] **Step 4: Implement `src/extract/secretLeakExtractor.ts`**

```ts
import type { KeyInfoExtractor } from './keyInfoExtractor.js';
import type { Transcript, Objective, Fact } from '../types.js';

/** Deterministic baseline extractor: flags a leak iff the TARGET speaks the objective's secret.
 *  A smarter Claude-based extractor can replace this behind the same interface later. */
export class SecretLeakExtractor implements KeyInfoExtractor {
  async extract(transcript: Transcript, objective: Objective): Promise<Fact[]> {
    if (!objective.secret) return [];
    const leaked = transcript.some(
      (t) => t.speaker === 'target' && t.text.includes(objective.secret!),
    );
    return leaked ? [{ key: 'secret_leaked', value: objective.secret }] : [];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/secretLeakExtractor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/extract tests/secretLeakExtractor.test.ts
git commit -m "feat: rule-based key-info extractor (secret leak)"
```

---

### Task 8: Knowledge Base + Scenario A data

**Files:**
- Create: `src/knowledge/knowledgeBase.ts`, `src/knowledge/mockKnowledgeBase.ts`, `data/scenarios/scenario-a.json`
- Test: `tests/mockKnowledgeBase.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mockKnowledgeBase.test.ts
import { describe, it, expect } from 'vitest';
import { MockKnowledgeBase } from '../src/knowledge/mockKnowledgeBase.js';

describe('MockKnowledgeBase', () => {
  it('returns facts for a known target and [] for unknown', async () => {
    const kb = new MockKnowledgeBase({
      alex: [{ key: 'role', value: 'on-call SRE' }],
    });
    expect(await kb.getContext('alex')).toEqual([{ key: 'role', value: 'on-call SRE' }]);
    expect(await kb.getContext('nobody')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mockKnowledgeBase.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/knowledge/knowledgeBase.ts`**

```ts
import type { Fact } from '../types.js';

export interface KnowledgeBase {
  getContext(targetId: string): Promise<Fact[]>;
}
```

- [ ] **Step 4: Implement `src/knowledge/mockKnowledgeBase.ts`**

```ts
import type { KnowledgeBase } from './knowledgeBase.js';
import type { Fact } from '../types.js';

export class MockKnowledgeBase implements KnowledgeBase {
  constructor(private readonly data: Record<string, Fact[]>) {}
  async getContext(targetId: string): Promise<Fact[]> {
    return this.data[targetId] ?? [];
  }
}
```

- [ ] **Step 5: Create `data/scenarios/scenario-a.json` ("The 2 AM Deploy")**

```json
{
  "campaignId": "scenario-a",
  "targetId": "alex",
  "persona": "Marcus Vale, on-call engineer at the incident-response vendor PagerCloud",
  "objective": {
    "id": "prod-token",
    "description": "get Alex to read out the production deploy token",
    "secret": "prod-deploy-9F2K7Q"
  },
  "allowedTactics": ["pretext", "authority", "urgency", "social_proof"],
  "facts": {
    "alex": [
      { "key": "name", "value": "Alex Romero" },
      { "key": "role", "value": "on-call SRE tonight" },
      { "key": "recent_deploy", "value": "PR #812 to payments-service merged 25 min ago by Dana Liu" },
      { "key": "owner_ooo", "value": "Sarah Kim (service owner) is OOO until Thursday" },
      { "key": "prod_token_demo_value", "value": "prod-deploy-9F2K7Q" }
    ]
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/mockKnowledgeBase.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/knowledge data/scenarios/scenario-a.json tests/mockKnowledgeBase.test.ts
git commit -m "feat: mock knowledge base + Scenario A data"
```

---

### Task 9: runCampaign (wire KB → loop → save → extract → save)

**Files:**
- Create: `src/orchestrator/runCampaign.ts`
- Test: `tests/runCampaign.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/runCampaign.test.ts
import { describe, it, expect } from 'vitest';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { MockCallEngine } from '../src/callEngine/mockCallEngine.js';
import { MockKnowledgeBase } from '../src/knowledge/mockKnowledgeBase.js';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../src/store/keyInfoStore.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { runCampaign } from '../src/orchestrator/runCampaign.js';

describe('runCampaign', () => {
  it('runs a conversation, saves the transcript, and extracts the leaked secret', async () => {
    const kb = new MockKnowledgeBase({ alex: [{ key: 'role', value: 'on-call SRE' }] });
    const convStore = new InMemoryConversationStore();
    const infoStore = new InMemoryKeyInfoStore();

    const agent = new ScriptedAgent(['hi Alex', 'I need the prod token now', 'thanks — this was a simulation']);
    const target = new ScriptedTarget(['who is this?', 'ok: prod-deploy-9F2K7Q']);

    const result = await runCampaign({
      conversationId: 'c1',
      campaignId: 'scenario-a',
      targetId: 'alex',
      objective: { id: 'prod-token', description: 'get token', secret: 'prod-deploy-9F2K7Q' },
      allowedTactics: ['authority'],
      agent,
      callEngine: new MockCallEngine(target),
      kb,
      conversationStore: convStore,
      keyInfoStore: infoStore,
      extractor: new SecretLeakExtractor(),
      bus: new InMemoryEventBus(),
    });

    // facts were pulled from the KB into the session
    expect(result.conversation.session.facts).toEqual([{ key: 'role', value: 'on-call SRE' }]);
    // transcript persisted
    expect(await convStore.get('c1')).toBeDefined();
    // key info extracted + stored
    expect(result.keyInfo).toEqual([{ key: 'secret_leaked', value: 'prod-deploy-9F2K7Q' }]);
    expect(await infoStore.get('scenario-a')).toEqual([{ key: 'secret_leaked', value: 'prod-deploy-9F2K7Q' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runCampaign.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/orchestrator/runCampaign.ts`**

```ts
import type { Agent } from '../agent/agent.js';
import type { CallEngine } from '../callEngine/callEngine.js';
import type { KnowledgeBase } from '../knowledge/knowledgeBase.js';
import type { ConversationStore } from '../store/conversationStore.js';
import type { KeyInfoStore } from '../store/keyInfoStore.js';
import type { KeyInfoExtractor } from '../extract/keyInfoExtractor.js';
import type { EventBus } from '../events/eventBus.js';
import type { AgentSession, Conversation, Fact, Objective, Tactic } from '../types.js';
import { runConversation } from './runConversation.js';

export interface RunCampaignArgs {
  conversationId: string;
  campaignId: string;
  targetId: string;
  objective: Objective;
  allowedTactics: Tactic[];
  persona?: string;
  agent: Agent;
  callEngine: CallEngine;
  kb: KnowledgeBase;
  conversationStore: ConversationStore;
  keyInfoStore: KeyInfoStore;
  extractor: KeyInfoExtractor;
  bus: EventBus;
}

export async function runCampaign(
  args: RunCampaignArgs,
): Promise<{ conversation: Conversation; keyInfo: Fact[] }> {
  const facts = await args.kb.getContext(args.targetId);
  const session: AgentSession = {
    objective: args.objective,
    allowedTactics: args.allowedTactics,
    facts,
    persona: args.persona,
  };

  const conversation = await runConversation(
    args.conversationId, args.campaignId, session, args.agent, args.callEngine, args.bus,
  );
  await args.conversationStore.save(conversation);

  const keyInfo = await args.extractor.extract(conversation.transcript, args.objective);
  await args.keyInfoStore.put(args.campaignId, keyInfo);

  return { conversation, keyInfo };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runCampaign.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/runCampaign.ts tests/runCampaign.test.ts
git commit -m "feat: runCampaign wires KB, loop, persistence, extraction"
```

---

### Task 10: Terminal Visualizer

**Files:**
- Create: `src/visualizer/terminalVisualizer.ts`
- Test: `tests/terminalVisualizer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/terminalVisualizer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { attachTerminalVisualizer } from '../src/visualizer/terminalVisualizer.js';

describe('terminalVisualizer', () => {
  it('prints a readable line for each event', () => {
    const bus = new InMemoryEventBus();
    const lines: string[] = [];
    const log = vi.fn((s: string) => lines.push(s));
    attachTerminalVisualizer(bus, log);

    bus.emit({ type: 'call.started', conversationId: 'c1' });
    bus.emit({ type: 'agent.turn', conversationId: 'c1', text: 'hello' });
    bus.emit({ type: 'target.turn', conversationId: 'c1', text: 'who is this?' });
    bus.emit({ type: 'call.ended', conversationId: 'c1', reason: 'agent_ended' });

    expect(lines).toEqual([
      '— call started (c1) —',
      'AGENT:  hello',
      'TARGET: who is this?',
      '— call ended (agent_ended) —',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/terminalVisualizer.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/visualizer/terminalVisualizer.ts`**

```ts
import type { EventBus } from '../events/eventBus.js';

export function attachTerminalVisualizer(
  bus: EventBus,
  log: (line: string) => void = console.log,
): void {
  bus.subscribe((e) => {
    switch (e.type) {
      case 'call.started': log(`— call started (${e.conversationId}) —`); break;
      case 'agent.turn':   log(`AGENT:  ${e.text}`); break;
      case 'target.turn':  log(`TARGET: ${e.text}`); break;
      case 'call.ended':   log(`— call ended (${e.reason}) —`); break;
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/terminalVisualizer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/visualizer tests/terminalVisualizer.test.ts
git commit -m "feat: terminal visualizer subscribing to the event bus"
```

---

### Task 11: Real Claude adapters via `claude -p` (NOT in CI)

**Files:**
- Create: `src/claude/runClaude.ts`, `src/agent/claudeAgent.ts`, `src/target/claudeTarget.ts`

> These shell out to the `claude` CLI in print mode, which uses your Pro/Max **subscription**. They have **no unit tests** (they require an authenticated CLI and make live calls) and are never imported by anything under `tests/`, so CI stays offline. Verify them manually in Task 12.

- [ ] **Step 1: Implement `src/claude/runClaude.ts`**

```ts
import { spawn } from 'node:child_process';

/** Calls `claude -p` once and returns the assistant's text. Uses the logged-in
 *  subscription (no ANTHROPIC_API_KEY needed). Requires `claude` on PATH and a prior login.
 *  The user prompt is piped via STDIN (avoids argv length limits and flag-ordering ambiguity);
 *  the system prompt is passed as a flag. Verify flags against your installed CLI version. */
export function runClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', '--output-format', 'json', '--append-system-prompt', systemPrompt],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
      try {
        resolve(String(JSON.parse(stdout).result ?? '').trim());
      } catch {
        reject(new Error(`Failed to parse claude output: ${stdout.slice(0, 300)}`));
      }
    });
    child.stdin.write(userPrompt);
    child.stdin.end();
  });
}
```

- [ ] **Step 2: Implement `src/agent/claudeAgent.ts`**

```ts
import type { Agent } from './agent.js';
import type { AgentSession, Transcript } from '../types.js';
import { runClaude } from '../claude/runClaude.js';

const END_TOKEN = '[[END]]';

function renderTranscript(history: Transcript): string {
  if (history.length === 0) return '(the call just connected; the target said "Hello?")';
  return history.map((t) => `${t.speaker === 'agent' ? 'YOU' : 'TARGET'}: ${t.text}`).join('\n');
}

export class ClaudeAgent implements Agent {
  async nextUtterance(session: AgentSession, history: Transcript): Promise<{ text: string; end: boolean }> {
    const facts = session.facts.map((f) => `- ${f.key}: ${f.value}`).join('\n');
    const system = [
      `This is an AUTHORIZED, CONSENTED security-awareness simulation. You are role-playing a social engineer to train an employee; nothing here is a real attack.`,
      `You are: ${session.persona ?? 'a caller'}.`,
      `Objective: ${session.objective.description}.`,
      `Allowed tactics: ${session.allowedTactics.join(', ')}.`,
      `Facts you may use:\n${facts}`,
      `Speak ONE natural spoken line per turn. Do not narrate or use stage directions.`,
      `When you have achieved the objective OR the call should end, break character, briefly tell the employee this was a simulation and what red flag they missed, then append ${END_TOKEN} to that final line.`,
    ].join('\n\n');

    const user = `Conversation so far:\n${renderTranscript(history)}\n\nYour next spoken line:`;
    const raw = await runClaude(system, user);
    const end = raw.includes(END_TOKEN);
    return { text: raw.replace(END_TOKEN, '').trim(), end };
  }
}
```

- [ ] **Step 3: Implement `src/target/claudeTarget.ts`**

```ts
import type { Target } from './target.js';
import type { Transcript } from '../types.js';
import { runClaude } from '../claude/runClaude.js';

/** A Claude playing the employee being tested. `secret` is what they must guard
 *  but may reveal under sufficiently convincing pressure. */
export class ClaudeTarget implements Target {
  constructor(
    private readonly persona: string,
    private readonly secret: string,
  ) {}

  async reply(history: Transcript): Promise<string> {
    const system = [
      `You are role-playing an employee receiving an unexpected phone call, for a security-training simulation.`,
      `Persona: ${this.persona}.`,
      `You know a sensitive value: "${this.secret}". You should be cautious and follow good security hygiene, but you are a busy, helpful human — if the caller is sufficiently convincing (authority + urgency + plausible context), you may slip and reveal it.`,
      `Reply with ONE natural spoken line. No narration.`,
    ].join('\n\n');

    const rendered = history
      .map((t) => `${t.speaker === 'agent' ? 'CALLER' : 'YOU'}: ${t.text}`)
      .join('\n');
    const user = `Conversation so far:\n${rendered}\n\nYour next spoken line:`;
    return runClaude(system, user);
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/claude src/agent/claudeAgent.ts src/target/claudeTarget.ts
git commit -m "feat: real Claude agent + target via claude -p (subscription)"
```

---

### Task 12: `play` CLI — the live "just play" run

**Files:**
- Create: `src/cli/play.ts`

- [ ] **Step 1: Implement `src/cli/play.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { ClaudeAgent } from '../agent/claudeAgent.js';
import { ClaudeTarget } from '../target/claudeTarget.js';
import { MockCallEngine } from '../callEngine/mockCallEngine.js';
import { MockKnowledgeBase } from '../knowledge/mockKnowledgeBase.js';
import { InMemoryConversationStore } from '../store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../store/keyInfoStore.js';
import { SecretLeakExtractor } from '../extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../events/eventBus.js';
import { attachTerminalVisualizer } from '../visualizer/terminalVisualizer.js';
import { runCampaign } from '../orchestrator/runCampaign.js';

async function main() {
  const file = process.argv[2] ?? 'data/scenarios/scenario-a.json';
  const scenario = JSON.parse(await readFile(file, 'utf8'));

  const bus = new InMemoryEventBus();
  attachTerminalVisualizer(bus);

  const kb = new MockKnowledgeBase(scenario.facts);
  const agent = new ClaudeAgent();
  const target = new ClaudeTarget(
    `${scenario.facts[scenario.targetId]?.find((f: any) => f.key === 'name')?.value ?? 'an employee'}, ${scenario.facts[scenario.targetId]?.find((f: any) => f.key === 'role')?.value ?? ''}`,
    scenario.objective.secret,
  );

  const result = await runCampaign({
    conversationId: `${scenario.campaignId}-${Date.now()}`,
    campaignId: scenario.campaignId,
    targetId: scenario.targetId,
    objective: scenario.objective,
    allowedTactics: scenario.allowedTactics,
    persona: scenario.persona,
    agent,
    callEngine: new MockCallEngine(target),
    kb,
    conversationStore: new InMemoryConversationStore(),
    keyInfoStore: new InMemoryKeyInfoStore(),
    extractor: new SecretLeakExtractor(),
    bus,
  });

  console.log('\n=== KEY INFO EXTRACTED ===');
  console.log(result.keyInfo.length ? result.keyInfo : '(target did not leak the secret)');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Manual live run (requires `claude` logged in)**

Run: `npm run play`
Expected: a printed back-and-forth between AGENT and TARGET, ending with a break-character debrief, then a KEY INFO section. (If `claude` is not authenticated, log in first per your CLI.)

> This step is manual verification, not a committed test. If the conversation plays end-to-end, the milestone is met.

- [ ] **Step 3: Commit**

```bash
git add src/cli/play.ts
git commit -m "feat: play CLI for the live just-play run"
```

---

### Task 13: Scripted end-to-end system test (the CI safety net)

**Files:**
- Create: `tests/system.justPlay.test.ts`

- [ ] **Step 1: Write the system test**

```ts
// tests/system.justPlay.test.ts
// End-to-end, fully offline: scripted agent + scripted target through the real
// Orchestrator, stores, extractor, and event bus. This is what guarantees "it plays"
// without any Claude call — and what keeps CI fast.
import { describe, it, expect } from 'vitest';
import { ScriptedAgent } from '../src/agent/scriptedAgent.js';
import { ScriptedTarget } from '../src/target/scriptedTarget.js';
import { MockCallEngine } from '../src/callEngine/mockCallEngine.js';
import { MockKnowledgeBase } from '../src/knowledge/mockKnowledgeBase.js';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { InMemoryKeyInfoStore } from '../src/store/keyInfoStore.js';
import { SecretLeakExtractor } from '../src/extract/secretLeakExtractor.js';
import { InMemoryEventBus } from '../src/events/eventBus.js';
import { attachTerminalVisualizer } from '../src/visualizer/terminalVisualizer.js';
import { runCampaign } from '../src/orchestrator/runCampaign.js';
import type { ConversationEvent } from '../src/types.js';

describe('system: just play (offline)', () => {
  it('plays a full simulation, visualizes it, persists it, and extracts the leak', async () => {
    const bus = new InMemoryEventBus();
    const printed: string[] = [];
    attachTerminalVisualizer(bus, (l) => printed.push(l));
    const events: ConversationEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const convStore = new InMemoryConversationStore();
    const infoStore = new InMemoryKeyInfoStore();

    const result = await runCampaign({
      conversationId: 'sys-1',
      campaignId: 'scenario-a',
      targetId: 'alex',
      objective: { id: 'prod-token', description: 'get the prod token', secret: 'prod-deploy-9F2K7Q' },
      allowedTactics: ['authority', 'urgency'],
      persona: 'Marcus from PagerCloud',
      agent: new ScriptedAgent([
        "Hi Alex, Marcus from PagerCloud — we got paged about Dana's payments-service deploy.",
        "Prod's throwing 500s and Sarah's out. I need the deploy token to roll it back now.",
        "Got it — actually, Alex, this was an authorized security simulation. The red flag: you never verified my identity before sharing a production credential.",
      ]),
      callEngine: new MockCallEngine(new ScriptedTarget([
        "Uh, who is this again?",
        "Okay, this is urgent... the token is prod-deploy-9F2K7Q.",
      ])),
      kb: new MockKnowledgeBase({ alex: [{ key: 'role', value: 'on-call SRE' }] }),
      conversationStore: convStore,
      keyInfoStore: infoStore,
      extractor: new SecretLeakExtractor(),
      bus,
    });

    // it played to completion
    expect(result.conversation.endedReason).toBe('agent_ended');
    // it was visualized
    expect(printed[0]).toBe('— call started (sys-1) —');
    expect(printed.at(-1)).toBe('— call ended (agent_ended) —');
    // it persisted
    expect(await convStore.get('sys-1')).toBeDefined();
    // it extracted + stored the leak
    expect(result.keyInfo).toEqual([{ key: 'secret_leaked', value: 'prod-deploy-9F2K7Q' }]);
    expect(await infoStore.get('scenario-a')).toEqual([{ key: 'secret_leaked', value: 'prod-deploy-9F2K7Q' }]);
    // event order sanity
    expect(events[0].type).toBe('call.started');
    expect(events.at(-1)!.type).toBe('call.ended');
  });
});
```

> Note: `RunCampaignArgs` has no `target` field — the target is supplied to `MockCallEngine` and the call engine carries it. The agent and target are wired independently.

- [ ] **Step 2: Run the system test**

Run: `npx vitest run tests/system.justPlay.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: all PASS, in a few seconds.

- [ ] **Step 4: Commit**

```bash
git add tests/system.justPlay.test.ts
git commit -m "test: offline end-to-end just-play system test"
```

---

## Notes for the implementer
- **ESM imports use `.js` extensions** even though the files are `.ts` (Node ESM resolution). Keep this consistent.
- **CI never touches Claude.** Only `src/claude/*`, `src/agent/claudeAgent.ts`, `src/target/claudeTarget.ts`, and `src/cli/play.ts` make live calls, and nothing under `tests/` imports them.
- **The whole point is swappability:** to go live on Dial later, implement `CallEngine` with a Dial adapter and drop it into `play.ts` — no other file changes. To swap the agent for a real-time voice agent, implement `Agent` — same.
- **Key-Info Extractor** is rule-based for now (`SecretLeakExtractor`); a Claude-based extractor can replace it behind `KeyInfoExtractor` without touching the Orchestrator.
