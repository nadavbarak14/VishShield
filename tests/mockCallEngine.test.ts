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
