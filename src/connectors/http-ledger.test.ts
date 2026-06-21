import { test, expect, describe } from 'vitest';
import { HttpLedgerConnector, type FetchLike } from './http-ledger.js';

function fakeFetch(routes: Record<string, { ok?: boolean; status?: number; body?: unknown; throws?: boolean }>): FetchLike {
  return async (url: string) => {
    const r = routes[url];
    if (!r || r.throws) throw new Error('network down');
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  };
}

describe('HttpLedgerConnector', () => {
  test('fetches balance from the REST endpoint', async () => {
    const c = new HttpLedgerConnector('https://ledger.test', {
      fetchImpl: fakeFetch({ 'https://ledger.test/accounts/acct_1/balance': { body: { balance: 1234 } } }),
    });
    expect(await c.balance('acct_1')).toBe(1234);
  });

  test('returns undefined on 404 (unknown account)', async () => {
    const c = new HttpLedgerConnector('https://ledger.test', {
      fetchImpl: fakeFetch({ 'https://ledger.test/accounts/x/balance': { ok: false, status: 404 } }),
    });
    expect(await c.balance('x')).toBeUndefined();
  });

  test('fails safe to undefined on network error (so reconcile escalates)', async () => {
    const c = new HttpLedgerConnector('https://ledger.test', {
      fetchImpl: fakeFetch({ 'https://ledger.test/accounts/x/balance': { throws: true } }),
    });
    expect(await c.balance('x')).toBeUndefined();
  });

  test('reads counterparty status', async () => {
    const c = new HttpLedgerConnector('https://ledger.test', {
      fetchImpl: fakeFetch({ 'https://ledger.test/counterparties/acct_evil': { body: { status: 'sanctioned' } } }),
    });
    expect(await c.counterpartyStatus('acct_evil')).toBe('sanctioned');
  });

  test('counterparty status fails safe to unknown on error', async () => {
    const c = new HttpLedgerConnector('https://ledger.test', {
      fetchImpl: fakeFetch({ 'https://ledger.test/counterparties/x': { throws: true } }),
    });
    expect(await c.counterpartyStatus('x')).toBe('unknown');
  });

  test('strips a trailing slash from the base URL', async () => {
    const c = new HttpLedgerConnector('https://ledger.test/', {
      fetchImpl: fakeFetch({ 'https://ledger.test/accounts/a/balance': { body: { balance: 1 } } }),
    });
    expect(await c.balance('a')).toBe(1);
  });
});
