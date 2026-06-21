/**
 * Shared behavioural test suite for the provenance store contract.
 *
 * Defines the conformance tests every {@link ProvenanceStore} backend must
 * pass — round-tripping, id uniqueness, seq ordering, filtering, paging, and
 * counting — so the in-memory, SQLite, and Postgres implementations are
 * exercised against one source of truth rather than duplicated per backend.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { ProvenanceStore } from './types.js';
import { RecordBuilder, verifyChain } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { Action } from '../core/action.js';
import { Verdict, CheckOutcome } from '../core/types.js';

/**
 * Register the behavioural contract every {@link ProvenanceStore} must satisfy.
 *
 * Call from a backend's test file to assert it honours the store semantics;
 * each test creates a fresh store via `makeStore` and closes it afterward.
 * Reused by the in-memory unit test and the Postgres integration test.
 *
 * @param name - Label for the backend, shown in the describe block.
 * @param makeStore - Factory that yields a fresh, empty {@link ProvenanceStore}
 *   for each test case.
 */
export function storeContract(name: string, makeStore: () => Promise<ProvenanceStore>): void {
  describe(`ProvenanceStore contract: ${name}`, () => {
    let store: ProvenanceStore;
    let builder: RecordBuilder;

    const rec = (verdict: Verdict, ts: string, opts?: { tenant?: string; runId?: string }) =>
      builder.append(
        {
          ...(opts?.tenant ? { tenant: opts.tenant } : {}),
          action: Action.payment({ amount: 100, from: 'a', to: 'b' }),
          context: { runId: opts?.runId ?? 'run_1' },
          checks: [{ check: 'schema', outcome: CheckOutcome.Pass, verdict: Verdict.Allow }],
          verdict,
        },
        ts,
      );

    beforeEach(async () => {
      store = await makeStore();
      builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 21)));
    });
    afterEach(async () => {
      await store.close();
    });

    test('append then getById round-trips a record exactly', async () => {
      const r = rec(Verdict.Allow, '2026-06-13T00:00:00.000Z');
      await store.append(r);
      const got = await store.getById(r.id);
      expect(got).toEqual(r);
    });

    test('getById returns null for unknown id', async () => {
      expect(await store.getById('nope')).toBeNull();
    });

    test('rejects duplicate id', async () => {
      const r = rec(Verdict.Allow, '2026-06-13T00:00:00.000Z');
      await store.append(r);
      await expect(store.append(r)).rejects.toThrow();
    });

    test('rejects a non-monotonic seq (backfill/out-of-order is not silently stored)', async () => {
      const r0 = rec(Verdict.Allow, '2026-06-13T00:00:00.000Z');
      const r1 = rec(Verdict.Allow, '2026-06-13T00:00:01.000Z');
      await store.append(r0);
      await store.append(r1);
      // A fresh id but a stale seq (<= current tail) must be rejected by every backend.
      const stale = { ...r1, id: 'rec_backfill', seq: 0 };
      await expect(store.append(stale)).rejects.toThrow();
      // The chain is unchanged: still exactly the two valid records.
      expect((await store.list()).map((r) => r.seq)).toEqual([0, 1]);
    });

    test('list returns records in seq order and verifies as a chain', async () => {
      const rs = [
        rec(Verdict.Allow, '2026-06-13T00:00:00.000Z'),
        rec(Verdict.Block, '2026-06-13T00:00:01.000Z'),
        rec(Verdict.Escalate, '2026-06-13T00:00:02.000Z'),
      ];
      for (const r of rs) await store.append(r);
      const listed = await store.list();
      expect(listed.map((r) => r.seq)).toEqual([0, 1, 2]);
      expect(verifyChain(listed)).toEqual({ ok: true });
    });

    test('tail returns the highest-seq record', async () => {
      expect(await store.tail()).toBeNull();
      const r0 = rec(Verdict.Allow, '2026-06-13T00:00:00.000Z');
      const r1 = rec(Verdict.Block, '2026-06-13T00:00:01.000Z');
      await store.append(r0);
      await store.append(r1);
      expect((await store.tail())?.id).toBe(r1.id);
    });

    test('query filters by verdict', async () => {
      await store.append(rec(Verdict.Allow, '2026-06-13T00:00:00.000Z'));
      await store.append(rec(Verdict.Block, '2026-06-13T00:00:01.000Z'));
      await store.append(rec(Verdict.Block, '2026-06-13T00:00:02.000Z'));
      const blocks = await store.query({ verdict: Verdict.Block });
      expect(blocks).toHaveLength(2);
      expect(blocks.every((r) => r.verdict === Verdict.Block)).toBe(true);
    });

    test('query filters by tenant and runId', async () => {
      await store.append(rec(Verdict.Allow, '2026-06-13T00:00:00.000Z', { tenant: 't1', runId: 'rA' }));
      await store.append(rec(Verdict.Allow, '2026-06-13T00:00:01.000Z', { tenant: 't2', runId: 'rB' }));
      expect(await store.query({ tenant: 't1' })).toHaveLength(1);
      expect(await store.query({ runId: 'rB' })).toHaveLength(1);
    });

    test('query filters by time window [since, until)', async () => {
      await store.append(rec(Verdict.Allow, '2026-06-13T00:00:00.000Z'));
      await store.append(rec(Verdict.Allow, '2026-06-13T00:00:05.000Z'));
      await store.append(rec(Verdict.Allow, '2026-06-13T00:00:10.000Z'));
      const mid = await store.query({
        since: '2026-06-13T00:00:05.000Z',
        until: '2026-06-13T00:00:10.000Z',
      });
      expect(mid).toHaveLength(1);
      expect(mid[0]!.ts).toBe('2026-06-13T00:00:05.000Z');
    });

    test('query honours limit and offset (seq order)', async () => {
      for (let i = 0; i < 5; i++) {
        await store.append(rec(Verdict.Allow, `2026-06-13T00:00:0${i}.000Z`));
      }
      const page = await store.query({ limit: 2, offset: 2 });
      expect(page.map((r) => r.seq)).toEqual([2, 3]);
    });

    test('count respects filter and ignores paging', async () => {
      await store.append(rec(Verdict.Allow, '2026-06-13T00:00:00.000Z'));
      await store.append(rec(Verdict.Block, '2026-06-13T00:00:01.000Z'));
      await store.append(rec(Verdict.Block, '2026-06-13T00:00:02.000Z'));
      expect(await store.count()).toBe(3);
      expect(await store.count({ verdict: Verdict.Block })).toBe(2);
      expect(await store.count({ verdict: Verdict.Block, limit: 1 })).toBe(2);
    });
  });
}
