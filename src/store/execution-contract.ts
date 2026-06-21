/**
 * Shared behavioural contract every {@link ExecutionReceiptStore} backend must satisfy.
 *
 * Exercised against the in-memory and SQLite backends so put/list/listByAuthorization and
 * put-idempotency are verified once rather than per backend.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Signer } from '../provenance/signing.js';
import { ExecutionReceiptSigner, ExecutionStatus, type ExecutionReceipt } from '../protocol/execution-receipt.js';
import type { ExecutionReceiptStore } from './execution-store.js';

const exec = Signer.fromSeed(Buffer.alloc(32, 12));
let seq = 0;
const signer = new ExecutionReceiptSigner(exec, 'bank-exec', () => `exec_${(seq += 1)}`);

function makeExecution(authId: string): ExecutionReceipt {
  return signer.sign({
    authorizationReceiptId: authId,
    authorizationReceiptDigest: 'a'.repeat(64),
    actualActionDigest: 'b'.repeat(64),
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:01.000Z',
    resultDigest: 'r'.repeat(64),
    executionStatus: ExecutionStatus.Succeeded,
  });
}

/**
 * Register the {@link ExecutionReceiptStore} contract for one backend.
 *
 * @param name - Label shown in the describe block.
 * @param makeStore - Factory yielding a fresh, empty store per test.
 */
export function executionStoreContract(name: string, makeStore: () => Promise<ExecutionReceiptStore>): void {
  describe(`ExecutionReceiptStore contract: ${name}`, () => {
    let store: ExecutionReceiptStore;
    beforeEach(async () => {
      store = await makeStore();
    });
    afterEach(async () => {
      await store.close();
    });

    test('put then list round-trips the execution receipt', async () => {
      const e = makeExecution('rcpt_1');
      await store.put(e);
      expect(await store.list()).toEqual([e]);
    });

    test('listByAuthorization filters to one authorization', async () => {
      const a1 = makeExecution('rcpt_a');
      const a2 = makeExecution('rcpt_a');
      const b = makeExecution('rcpt_b');
      await store.put(a1);
      await store.put(a2);
      await store.put(b);
      expect((await store.listByAuthorization('rcpt_a')).map((e) => e.executionId)).toEqual([a1.executionId, a2.executionId]);
      expect((await store.listByAuthorization('rcpt_b')).map((e) => e.executionId)).toEqual([b.executionId]);
    });

    test('put is idempotent on executionId', async () => {
      const e = makeExecution('rcpt_1');
      await store.put(e);
      await store.put(e);
      expect(await store.list()).toHaveLength(1);
    });
  });
}
