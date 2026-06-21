import { test, expect, describe, beforeEach } from 'vitest';
import { Engine } from './engine.js';
import { InMemoryStore } from '../store/memory.js';
import { RecordBuilder, verifyChain } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { Action } from '../core/action.js';
import { CheckTier } from '../checks/types.js';
import type { Check, CheckInput } from '../checks/types.js';
import { Verdict, CheckOutcome } from '../core/types.js';
import type { CheckResult, GuardRequest } from '../core/types.js';

class FakeCheck implements Check {
  ran = false;
  constructor(
    readonly name: string,
    readonly tier: CheckTier,
    private readonly verdict: Verdict,
    private readonly delayMs = 0,
  ) {}
  async run(_input: CheckInput): Promise<CheckResult> {
    this.ran = true;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const outcome =
      this.verdict === Verdict.Allow
        ? CheckOutcome.Pass
        : this.verdict === Verdict.Block
          ? CheckOutcome.Fail
          : CheckOutcome.Inconclusive;
    return { check: this.name, outcome, verdict: this.verdict, reason: `${this.name} says ${this.verdict}` };
  }
}

const request: GuardRequest = {
  action: Action.payment({ amount: 100, from: 'a', to: 'b' }),
  context: { runId: 'run_1', provider: 'anthropic', model: 'claude-sonnet-4-6' },
  policy: 'test',
};

function makeEngine(checks: Check[], opts: Partial<ConstructorParameters<typeof Engine>[0]> = {}) {
  const store = new InMemoryStore();
  const builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 31)));
  const engine = new Engine({ resolve: () => checks, builder, store, slowBudgetMs: 50, ...opts });
  return { engine, store };
}

describe('Engine', () => {
  let store: InMemoryStore;
  let engine: Engine;

  test('returns ALLOW when all checks allow, and persists a record', async () => {
    ({ engine, store } = makeEngine([new FakeCheck('a', CheckTier.Fast, Verdict.Allow), new FakeCheck('b', CheckTier.Slow, Verdict.Allow)]));
    const d = await engine.guard(request);
    expect(d.verdict).toBe(Verdict.Allow);
    expect(d.recordId).toMatch(/^rec_/);
    const rec = await store.getById(d.recordId);
    expect(rec?.verdict).toBe(Verdict.Allow);
    expect(rec?.context.model).toBe('claude-sonnet-4-6');
  });

  test('BLOCK beats ESCALATE beats ALLOW', async () => {
    ({ engine } = makeEngine([
      new FakeCheck('a', CheckTier.Fast, Verdict.Allow),
      new FakeCheck('e', CheckTier.Fast, Verdict.Escalate),
      new FakeCheck('b', CheckTier.Fast, Verdict.Block),
    ]));
    expect((await engine.guard(request)).verdict).toBe(Verdict.Block);
  });

  test('ESCALATE when a check escalates and none block', async () => {
    ({ engine } = makeEngine([new FakeCheck('a', CheckTier.Fast, Verdict.Allow), new FakeCheck('e', CheckTier.Slow, Verdict.Escalate)]));
    expect((await engine.guard(request)).verdict).toBe(Verdict.Escalate);
  });

  test('short-circuits: a fast BLOCK skips slow checks (no model spend)', async () => {
    const slow = new FakeCheck('slow', CheckTier.Slow, Verdict.Allow);
    ({ engine } = makeEngine([new FakeCheck('fastblock', CheckTier.Fast, Verdict.Block), slow]));
    const d = await engine.guard(request);
    expect(d.verdict).toBe(Verdict.Block);
    expect(slow.ran).toBe(false);
    expect(d.checks.find((c) => c.check === 'slow')).toBeUndefined();
  });

  test('slow check exceeding the budget escalates (fail-safe) with a timeout result', async () => {
    ({ engine } = makeEngine([new FakeCheck('a', CheckTier.Fast, Verdict.Allow), new FakeCheck('laggy', CheckTier.Slow, Verdict.Allow, 500)], { slowBudgetMs: 20 }));
    const d = await engine.guard(request);
    expect(d.verdict).toBe(Verdict.Escalate);
    const laggy = d.checks.find((c) => c.check === 'laggy');
    expect(laggy?.verdict).toBe(Verdict.Escalate);
    expect(laggy?.reason).toMatch(/timed out|timeout/i);
  });

  test('records per-check latency', async () => {
    ({ engine } = makeEngine([new FakeCheck('a', CheckTier.Fast, Verdict.Allow)]));
    const d = await engine.guard(request);
    expect(typeof d.checks[0]!.latencyMs).toBe('number');
  });

  test('persists an append-only chain that verifies', async () => {
    ({ engine, store } = makeEngine([new FakeCheck('a', CheckTier.Fast, Verdict.Allow)]));
    await engine.guard(request);
    await engine.guard(request);
    const chain = await store.list();
    expect(chain).toHaveLength(2);
    expect(verifyChain(chain)).toEqual({ ok: true });
  });

  test('aggregated reason includes the deciding check reason', async () => {
    ({ engine } = makeEngine([new FakeCheck('fastblock', CheckTier.Fast, Verdict.Block)]));
    const d = await engine.guard(request);
    expect(d.reason).toMatch(/fastblock says BLOCK/);
  });
});

class ThrowingCheck implements Check {
  constructor(
    readonly name: string,
    readonly tier: CheckTier,
    private readonly delayMs = 0,
  ) {}
  async run(_input: CheckInput): Promise<CheckResult> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    throw new Error('boom');
  }
}

describe('Engine fail-safe', () => {
  test('a throwing FAST check votes ESCALATE (never crashes, never ALLOWs)', async () => {
    const { engine } = makeEngine([new ThrowingCheck('bad', CheckTier.Fast)]);
    const d = await engine.guard(request);
    expect(d.verdict).toBe(Verdict.Escalate);
    expect(d.checks[0]?.reason).toMatch(/check errored: boom/);
  });

  test('a throwing SLOW check votes ESCALATE', async () => {
    const { engine } = makeEngine([new ThrowingCheck('badslow', CheckTier.Slow)]);
    const d = await engine.guard(request);
    expect(d.verdict).toBe(Verdict.Escalate);
  });

  test('a slow check that rejects AFTER the deadline does not crash (no unhandled rejection)', async () => {
    let unhandled: unknown;
    const onUnhandled = (e: unknown) => (unhandled = e);
    process.on('unhandledRejection', onUnhandled);
    try {
      // delay (80ms) exceeds slowBudgetMs (50ms): timeout wins, then run() rejects late.
      const { engine } = makeEngine([new ThrowingCheck('lateslow', CheckTier.Slow, 80)]);
      const d = await engine.guard(request);
      expect(d.verdict).toBe(Verdict.Escalate); // timed out -> fail-safe
      await new Promise((r) => setTimeout(r, 120)); // let the late rejection fire
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toBeUndefined();
  });

  test('a policy resolving to NO checks ESCALATEs rather than silently ALLOWing', async () => {
    const { engine } = makeEngine([]);
    const d = await engine.guard(request);
    expect(d.verdict).toBe(Verdict.Escalate);
    expect(d.reason).toMatch(/no checks/);
  });

  test('a check with an unknown tier ESCALATEs (not silently dropped to ALLOW)', async () => {
    // A typo'd/unknown tier lands in neither the fast nor slow partition.
    const badTier = new FakeCheck('weird', 'medium' as unknown as CheckTier, Verdict.Block);
    const { engine } = makeEngine([badTier]);
    const d = await engine.guard(request);
    expect(d.verdict).toBe(Verdict.Escalate);
    expect(d.reason).toMatch(/runnable tier/);
  });

  test('appendRecord is serialized with guard() — concurrent appends do not fork the chain', async () => {
    const store = new InMemoryStore();
    const builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 51)));
    const engine = new Engine({ resolve: () => [new FakeCheck('ok', CheckTier.Fast, Verdict.Allow)], builder, store });
    const human = {
      action: Action.payment({ amount: 1, from: 'a', to: 'b' }),
      context: { runId: 'r' },
      checks: [{ check: 'human.review', outcome: CheckOutcome.Pass, verdict: Verdict.Allow }],
      verdict: Verdict.Allow,
    };
    // Fire a guard and an out-of-band record concurrently against the SAME builder.
    await Promise.all([engine.guard(request), engine.appendRecord(human), engine.guard(request)]);
    const records = await store.list();
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(verifyChain(records, [builder.keyId])).toEqual({ ok: true });
  });

  test('builder resyncs after a transient append failure so the chain stays unforked', async () => {
    const store = new InMemoryStore();
    const builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 41)));
    let failNext = true;
    const realAppend = store.append.bind(store);
    store.append = async (rec) => {
      if (failNext) {
        failNext = false;
        throw new Error('transient disk error'); // non-conflict -> propagates after resync
      }
      return realAppend(rec);
    };
    const engine = new Engine({ resolve: () => [new FakeCheck('ok', CheckTier.Fast, Verdict.Allow)], builder, store });

    await expect(engine.guard(request)).rejects.toThrow(/transient/);
    // Next guard must succeed and the persisted chain must verify (seq 0, GENESIS link — no gap).
    await engine.guard(request);
    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.seq).toBe(0);
    expect(verifyChain(records, [builder.keyId])).toEqual({ ok: true });
  });
});
