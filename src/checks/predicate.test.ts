import { test, expect, describe } from 'vitest';
import { PredicateCheck } from './predicate.js';
import { Action } from '../core/action.js';
import { CheckTier } from './types.js';
import { Verdict, CheckOutcome } from '../core/types.js';

const input = { action: Action.payment({ amount: 100, from: 'a', to: 'acct_evil' }), context: { runId: 'r1' } };

describe('PredicateCheck', () => {
  test('uses the provided name and tier', () => {
    const c = new PredicateCheck({ name: 'counterparty', tier: CheckTier.Slow, predicate: async () => ({ verdict: Verdict.Allow }) });
    expect(c.name).toBe('counterparty');
    expect(c.tier).toBe(CheckTier.Slow);
  });

  test('maps verdict to outcome and passes through reason/details', async () => {
    const c = new PredicateCheck({
      name: 'counterparty',
      tier: CheckTier.Slow,
      predicate: async (i) => (i.action.payload.to === 'acct_evil' ? { verdict: Verdict.Block, reason: 'sanctioned', details: { to: 'acct_evil' } } : { verdict: Verdict.Allow }),
    });
    const r = await c.run(input);
    expect(r).toMatchObject({ check: 'counterparty', outcome: CheckOutcome.Fail, verdict: Verdict.Block, reason: 'sanctioned', details: { to: 'acct_evil' } });
  });

  test('fails safe to ESCALATE when the predicate throws', async () => {
    const c = new PredicateCheck({
      name: 'counterparty',
      tier: CheckTier.Slow,
      predicate: async () => {
        throw new Error('lookup failed');
      },
    });
    const r = await c.run(input);
    expect(r.verdict).toBe(Verdict.Escalate);
    expect(r.outcome).toBe(CheckOutcome.Inconclusive);
  });
});
