import { test, expect, describe } from 'vitest';
import { createResumedBuilder } from './bootstrap.js';
import { InMemoryStore } from '../store/memory.js';
import { RecordBuilder, verifyChain } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { Action } from '../core/action.js';
import { Verdict, CheckOutcome } from '../core/types.js';

const signer = () => Signer.fromSeed(Buffer.alloc(32, 61));
const input = {
  action: Action.payment({ amount: 1, from: 'a', to: 'b' }),
  context: { runId: 'r' },
  checks: [{ check: 'x', outcome: CheckOutcome.Pass, verdict: Verdict.Allow }],
  verdict: Verdict.Allow,
};

describe('createResumedBuilder', () => {
  test('starts at seq 0 on an empty store', async () => {
    const store = new InMemoryStore();
    const builder = await createResumedBuilder(store, signer());
    const r = builder.append(input);
    expect(r.seq).toBe(0);
  });

  test('resumes seq and chain linkage from the persisted tail (restart continuity)', async () => {
    const store = new InMemoryStore();
    // First "process": write two records.
    const b1 = new RecordBuilder(signer());
    await store.append(b1.append(input, '2026-06-13T00:00:00.000Z'));
    await store.append(b1.append(input, '2026-06-13T00:00:01.000Z'));

    // Second "process": resume from the store tail.
    const b2 = await createResumedBuilder(store, signer());
    const r2 = b2.append(input, '2026-06-13T00:00:02.000Z');
    await store.append(r2);

    expect(r2.seq).toBe(2);
    const chain = await store.list();
    expect(verifyChain(chain)).toEqual({ ok: true });
  });
});
