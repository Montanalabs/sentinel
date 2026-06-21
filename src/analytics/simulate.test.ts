import { test, expect, describe } from 'vitest';
import { simulate } from './simulate.js';
import { RecordBuilder } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { Action } from '../core/action.js';
import { PolicyCheck, RuleEffect } from '../checks/policy.js';
import { Verdict } from '../core/types.js';
import { CompareOp } from '../checks/condition.js';

function history(amounts: number[]) {
  const b = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 111)));
  return amounts.map((amount, i) =>
    b.append(
      { action: Action.payment({ amount, from: 'a', to: 'b' }), context: { runId: 'r1' }, checks: [], verdict: Verdict.Allow },
      `2026-06-13T00:00:0${i}.000Z`,
    ),
  );
}

const candidate = () => [
  new PolicyCheck({
    id: 'sim',
    rules: [{ id: 'block_high', when: { field: 'action.payload.amount', op: CompareOp.Gt, value: 25000 }, effect: RuleEffect.Block, reason: 'too high under new policy' }],
  }),
];

describe('simulate (policy back-test)', () => {
  test('reports which historical decisions a candidate policy would change', async () => {
    const report = await simulate(history([100, 50000, 200]), candidate());
    expect(report.total).toBe(3);
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0]).toMatchObject({ was: 'ALLOW', now: 'BLOCK' });
    expect(report.unchanged).toBe(2);
  });

  test('tallies transitions', async () => {
    const report = await simulate(history([100, 50000, 80000]), candidate());
    expect(report.byTransition['ALLOW->BLOCK']).toBe(2);
  });

  test('does not mutate or persist into the historical record set', async () => {
    const hist = history([50000]);
    const before = hist[0]!.contentHash;
    await simulate(hist, candidate());
    expect(hist[0]!.contentHash).toBe(before);
  });
});
