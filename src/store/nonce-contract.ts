/**
 * Shared behavioural contract every {@link NonceStore} backend must satisfy.
 *
 * Exercised against the in-memory and SQLite backends as unit tests and against Postgres as an
 * integration test, so replay/single-use semantics are verified once rather than per backend.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { NonceStore } from './nonce-store.js';

/**
 * Register the {@link NonceStore} contract for one backend.
 *
 * @param name - Label shown in the describe block.
 * @param makeStore - Factory yielding a fresh, empty store per test.
 */
export function nonceStoreContract(name: string, makeStore: () => Promise<NonceStore>): void {
  describe(`NonceStore contract: ${name}`, () => {
    let store: NonceStore;
    beforeEach(async () => {
      store = await makeStore();
    });
    afterEach(async () => {
      await store.close();
    });

    test('the first consume claims slot 1', async () => {
      expect(await store.consume('r1', 'nonce-a', 1)).toEqual({ consumed: true, executionCount: 1 });
    });

    test('single-use: a second consume is a replay', async () => {
      await store.consume('r1', 'nonce-a', 1);
      expect(await store.consume('r1', 'nonce-a', 1)).toEqual({ consumed: false, executionCount: 1 });
    });

    test('maxExecutions > 1 allows exactly that many, then replays', async () => {
      expect((await store.consume('r1', 'n', 3)).executionCount).toBe(1);
      expect((await store.consume('r1', 'n', 3)).executionCount).toBe(2);
      expect((await store.consume('r1', 'n', 3)).executionCount).toBe(3);
      expect(await store.consume('r1', 'n', 3)).toEqual({ consumed: false, executionCount: 3 });
    });

    test('distinct nonces are independent', async () => {
      await store.consume('r1', 'n1', 1);
      expect((await store.consume('r2', 'n2', 1)).consumed).toBe(true);
    });

    test('concurrent consumes of one single-use nonce: exactly one wins', async () => {
      const attempts = Array.from({ length: 25 }, () => store.consume('r1', 'race', 1));
      const results = await Promise.all(attempts);
      expect(results.filter((r) => r.consumed).length).toBe(1);
      expect(results.filter((r) => !r.consumed).length).toBe(24);
    });

    test('concurrent consumes never exceed maxExecutions', async () => {
      const attempts = Array.from({ length: 25 }, () => store.consume('r1', 'race2', 5));
      const results = await Promise.all(attempts);
      expect(results.filter((r) => r.consumed).length).toBe(5);
    });
  });
}
