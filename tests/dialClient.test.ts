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
