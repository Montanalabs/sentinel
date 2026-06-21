import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { PostgresStore } from './postgres.js';
import { Engine } from '../engine/engine.js';
import { RecordBuilder, verifyChain } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { Action } from '../core/action.js';
import type { Check } from '../checks/types.js';
import { CheckTier } from '../checks/types.js';
import type { GuardRequest } from '../core/types.js';
import { CheckOutcome, Verdict } from '../core/types.js';

const url = process.env.SENTINEL_TEST_DATABASE_URL;
const allow: Check = { name: 'allow', tier: CheckTier.Fast, run: async () => ({ check: 'allow', outcome: CheckOutcome.Pass, verdict: Verdict.Allow }) };

const suite = url ? describe : describe.skip;

suite('HA: concurrent writers on one Postgres chain', () => {
  let store: PostgresStore;

  beforeAll(async () => {
    store = await PostgresStore.connect(url!, { reset: true });
  });
  afterAll(async () => {
    await store.close();
  });

  test('resilient append keeps one valid, gap-free chain under contention', async () => {
    // Two independent sidecars (own signer + builder) sharing one store.
    const engineFor = (seed: number) =>
      new Engine({
        resolve: () => [allow],
        builder: new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, seed))),
        store,
        appendRetries: 100,
      });
    const a = engineFor(220);
    const b = engineFor(221);

    const req = (n: number): GuardRequest => ({
      action: Action.payment({ amount: n, from: 'a', to: 'b' }),
      context: { runId: 'ha' },
      policy: 'p',
    });

    const N = 12;
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < N; i++) {
      ops.push(a.guard(req(i)));
      ops.push(b.guard(req(1000 + i)));
    }
    await Promise.all(ops);

    expect(await store.count()).toBe(N * 2);
    const chain = await store.list();
    expect(chain.map((r) => r.seq)).toEqual([...Array(N * 2).keys()]); // contiguous 0..2N-1
    expect(verifyChain(chain)).toEqual({ ok: true });
  });
});
