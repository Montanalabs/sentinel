import { test, expect, describe } from 'vitest';
import { Engine } from './engine.js';
import { InMemoryStore } from '../store/memory.js';
import { RecordBuilder, verifyChain, type ProvenanceRecord } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { Action } from '../core/action.js';
import { CheckTier, type Check } from '../checks/types.js';
import { CheckOutcome, Verdict, type GuardRequest } from '../core/types.js';
import type { ProvenanceStore, ProvenanceFilter } from '../store/types.js';

const allow: Check = { name: 'a', tier: CheckTier.Fast, run: async () => ({ check: 'a', outcome: CheckOutcome.Pass, verdict: Verdict.Allow }) };
const req = (n: number): GuardRequest => ({
  action: Action.payment({ amount: n, from: 'a', to: 'b' }),
  context: { runId: 'run_multi' },
  policy: 'p',
});

describe('Engine.guardBatch (multi-agent fan-out)', () => {
  test('gates every action in a fan-out and keeps one linked chain', async () => {
    const store = new InMemoryStore();
    const engine = new Engine({ resolve: () => [allow], builder: new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 121))), store });
    const decisions = await engine.guardBatch([req(1), req(2), req(3)]);
    expect(decisions).toHaveLength(3);
    const chain = await store.list();
    expect(chain.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(verifyChain(chain)).toEqual({ ok: true });
  });
});

// A store that simulates a competing concurrent writer stealing a seq slot.
class FlakyStore implements ProvenanceStore {
  private inner = new InMemoryStore();
  private phantomBuilder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 200)));
  constructor(private failsLeft: number) {}
  async append(record: ProvenanceRecord): Promise<void> {
    if (this.failsLeft > 0) {
      this.failsLeft--;
      // a competing writer commits its own valid record at this seq first:
      const phantom = this.phantomBuilder.append(
        { action: record.action, context: record.context, checks: [], verdict: record.verdict },
        record.ts,
      );
      await this.inner.append(phantom);
      throw new Error('duplicate record id or seq');
    }
    return this.inner.append(record);
  }
  getById(id: string) { return this.inner.getById(id); }
  query(f?: ProvenanceFilter) { return this.inner.query(f); }
  tail() { return this.inner.tail(); }
  list() { return this.inner.list(); }
  count(f?: ProvenanceFilter) { return this.inner.count(f); }
  close() { return this.inner.close(); }
}

describe('Engine concurrent guard() on one engine', () => {
  test('serializes the append critical section so the chain stays valid', async () => {
    const store = new InMemoryStore();
    const engine = new Engine({ resolve: () => [allow], builder: new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 124))), store });
    // Fire 20 guards concurrently on the SAME engine (shared builder).
    await Promise.all(Array.from({ length: 20 }, (_, i) => engine.guard(req(i))));
    const chain = await store.list();
    expect(chain.map((r) => r.seq)).toEqual([...Array(20).keys()]);
    expect(verifyChain(chain)).toEqual({ ok: true });
  });
});

describe('Engine resilient append (HA concurrent writers)', () => {
  test('retries on a seq conflict by re-resuming from the store tail', async () => {
    const store = new FlakyStore(1);
    const engine = new Engine({
      resolve: () => [allow],
      builder: new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 122))),
      store,
      appendRetries: 3,
    });
    const d = await engine.guard(req(1));
    expect(d.verdict).toBe(Verdict.Allow);
    const chain = await store.list();
    // phantom (from the competing writer) + our retried record, still a valid chain
    expect(chain).toHaveLength(2);
    expect(verifyChain(chain)).toEqual({ ok: true });
  });

  test('gives up after exhausting retries', async () => {
    const store = new FlakyStore(5);
    const engine = new Engine({
      resolve: () => [allow],
      builder: new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 123))),
      store,
      appendRetries: 2,
    });
    await expect(engine.guard(req(1))).rejects.toThrow();
  });
});
