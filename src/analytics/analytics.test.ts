import { test, expect, describe } from 'vitest';
import { analyze, runCoverage } from './analytics.js';
import { RecordBuilder } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { Action } from '../core/action.js';
import { Verdict } from '../core/types.js';

function records(specs: Array<{ verdict: Verdict; type?: string; tenant?: string; reason?: string; to?: string; runId?: string }>) {
  const b = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 101)));
  return specs.map((s, i) =>
    b.append(
      {
        ...(s.tenant ? { tenant: s.tenant } : {}),
        action: Action.of(s.type ?? 'payment', { amount: 1, from: 'a', to: s.to ?? 'b' }),
        context: { runId: s.runId ?? 'run_1' },
        checks: [],
        verdict: s.verdict,
        ...(s.reason ? { reason: s.reason } : {}),
      },
      `2026-06-13T00:00:${String(i).padStart(2, '0')}.000Z`,
    ),
  );
}

describe('analyze', () => {
  test('computes verdict counts and rates', () => {
    const a = analyze(records([{ verdict: Verdict.Allow }, { verdict: Verdict.Allow }, { verdict: Verdict.Block }, { verdict: Verdict.Escalate }]));
    expect(a.total).toBe(4);
    expect(a.byVerdict).toEqual({ ALLOW: 2, BLOCK: 1, ESCALATE: 1 });
    expect(a.blockRate).toBeCloseTo(0.25);
    expect(a.escalateRate).toBeCloseTo(0.25);
    expect(a.allowRate).toBeCloseTo(0.5);
  });

  test('breaks down by action type and tenant', () => {
    const a = analyze(records([
      { verdict: Verdict.Allow, type: 'payment', tenant: 't1' },
      { verdict: Verdict.Block, type: 'email', tenant: 't2' },
      { verdict: Verdict.Allow, type: 'payment', tenant: 't1' },
    ]));
    expect(a.byActionType).toEqual({ payment: 2, email: 1 });
    expect(a.byTenant).toEqual({ t1: 2, t2: 1 });
  });

  test('ranks top reasons among non-ALLOW decisions', () => {
    const a = analyze(records([
      { verdict: Verdict.Block, reason: 'insufficient funds' },
      { verdict: Verdict.Block, reason: 'insufficient funds' },
      { verdict: Verdict.Escalate, reason: 'high value' },
      { verdict: Verdict.Allow, reason: 'should be ignored' },
    ]));
    expect(a.topReasons[0]).toEqual({ reason: 'insufficient funds', count: 2 });
    expect(a.topReasons.find((r) => r.reason === 'should be ignored')).toBeUndefined();
  });

  test('handles an empty record set without dividing by zero', () => {
    const a = analyze([]);
    expect(a.total).toBe(0);
    expect(a.blockRate).toBe(0);
  });
});

describe('runCoverage', () => {
  test('summarizes all gated actions under a run and flags duplicate actions', () => {
    const rs = records([
      { verdict: Verdict.Allow, runId: 'runX', to: 'b' },
      { verdict: Verdict.Block, runId: 'runX', to: 'b' }, // same fingerprint as first (same type+payload)
      { verdict: Verdict.Allow, runId: 'runX', to: 'c' },
      { verdict: Verdict.Allow, runId: 'other' },
    ]);
    const cov = runCoverage(rs, 'runX');
    expect(cov.total).toBe(3);
    expect(cov.verdicts).toEqual({ ALLOW: 2, BLOCK: 1, ESCALATE: 0 });
    expect(cov.duplicateFingerprints.length).toBe(1);
  });
});
