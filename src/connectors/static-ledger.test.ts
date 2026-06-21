import { test, expect, describe } from 'vitest';
import { StaticLedgerConnector } from './static-ledger.js';

describe('StaticLedgerConnector', () => {
  const ledger = new StaticLedgerConnector({
    balances: { acct_1: 5000, acct_2: 0 },
    sanctioned: ['acct_evil'],
  });

  test('name', () => {
    expect(ledger.name).toBe('static-ledger');
  });

  test('returns known balances', async () => {
    expect(await ledger.balance('acct_1')).toBe(5000);
    expect(await ledger.balance('acct_2')).toBe(0);
  });

  test('returns undefined for unknown accounts', async () => {
    expect(await ledger.balance('acct_unknown')).toBeUndefined();
  });

  test('flags sanctioned counterparties', async () => {
    expect(await ledger.counterpartyStatus('acct_evil')).toBe('sanctioned');
  });

  test('treats non-sanctioned counterparties as ok', async () => {
    expect(await ledger.counterpartyStatus('acct_1')).toBe('ok');
  });
});
