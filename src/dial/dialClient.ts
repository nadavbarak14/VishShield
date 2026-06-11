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
