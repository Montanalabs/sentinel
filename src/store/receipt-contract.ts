/**
 * Shared behavioural contract every {@link ReceiptStore} backend must satisfy.
 *
 * Exercised against the in-memory and SQLite backends so put/get/list and put-idempotency are
 * verified once rather than per backend.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Signer } from '../provenance/signing.js';
import { Verdict } from '../core/types.js';
import { ReceiptIssuer } from '../protocol/receipt-issuer.js';
import type { AuthorizationReceipt } from '../protocol/authorization-receipt.js';
import type { ReceiptStore } from './receipt-store.js';

const gate = Signer.fromSeed(Buffer.alloc(32, 11));
const issuer = new ReceiptIssuer(gate, { issuer: 'gate', now: () => 1_700_000_000_000, defaultTtlMs: 60_000 });

let seq = 0;
function makeReceipt(): AuthorizationReceipt {
  seq += 1;
  return issuer.issue({
    actionDigest: seq.toString(16).padStart(64, '0'),
    contextDigest: 'c'.repeat(64),
    policyBundleDigest: 'f'.repeat(64),
    policyVersion: 'v1',
    evidenceDigest: 'e'.repeat(64),
    deterministicVerdict: Verdict.Allow,
    finalVerdict: Verdict.Allow,
  });
}

/**
 * Register the {@link ReceiptStore} contract for one backend.
 *
 * @param name - Label shown in the describe block.
 * @param makeStore - Factory yielding a fresh, empty store per test.
 */
export function receiptStoreContract(name: string, makeStore: () => Promise<ReceiptStore>): void {
  describe(`ReceiptStore contract: ${name}`, () => {
    let store: ReceiptStore;
    beforeEach(async () => {
      store = await makeStore();
    });
    afterEach(async () => {
      await store.close();
    });

    test('put then get round-trips the receipt', async () => {
      const r = makeReceipt();
      await store.put(r);
      expect(await store.get(r.receiptId)).toEqual(r);
    });

    test('get of an unknown id is undefined', async () => {
      expect(await store.get('rcpt_missing')).toBeUndefined();
    });

    test('list returns all receipts in insertion order', async () => {
      const a = makeReceipt();
      const b = makeReceipt();
      await store.put(a);
      await store.put(b);
      expect((await store.list()).map((r) => r.receiptId)).toEqual([a.receiptId, b.receiptId]);
    });

    test('put is idempotent: a repeat put neither duplicates nor mutates', async () => {
      const r = makeReceipt();
      await store.put(r);
      await store.put({ ...r, policyVersion: 'TAMPERED' }); // same id, different body
      const all = await store.list();
      expect(all).toHaveLength(1);
      expect(all[0]?.policyVersion).toBe('v1'); // original preserved
    });
  });
}
