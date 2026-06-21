import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { buildSentinel } from './bootstrap.js';
import { StaticLedgerConnector } from '../connectors/static-ledger.js';
import type { BuiltSentinel } from './bootstrap.js';

// Boots the real sidecar over a real port with the mock provider (no API keys),
// exercising the full HTTP path. Runs under `npm run test:int`.
describe('Sentinel boot (real HTTP, mock provider)', () => {
  let sentinel: BuiltSentinel;
  let endpoint: string;
  const port = 4099;

  beforeAll(async () => {
    sentinel = await buildSentinel(
      { sidecarPort: port, secondOpinionProvider: 'mock' },
      { ledger: new StaticLedgerConnector({ balances: { acct_ops: 100_000 }, sanctioned: ['acct_bad'] }) },
    );
    await sentinel.app.listen({ port, host: '127.0.0.1' });
    endpoint = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await sentinel.close();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${endpoint}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const guard = (to: string, id: string) =>
    post('/v1/guard', {
      action: { id, type: 'payment', payload: { amount: 100, from: 'acct_ops', to } },
      context: { runId: 'boot-1' },
      policy: 'fintech.payments',
    }).then((r) => r.json() as Promise<{ verdict: string }>);

  test('healthz responds', async () => {
    const res = await fetch(`${endpoint}/healthz`);
    expect(((await res.json()) as { status: string }).status).toBe('ok');
  });

  test('guards a payment and blocks a sanctioned counterparty over real HTTP', async () => {
    expect((await guard('vendor', 'a1')).verdict).toBe('ALLOW');
    expect((await guard('acct_bad', 'a2')).verdict).toBe('BLOCK');
    const verify = await (await fetch(`${endpoint}/v1/verify`)).json();
    expect(verify).toEqual({ ok: true });
  });
});
