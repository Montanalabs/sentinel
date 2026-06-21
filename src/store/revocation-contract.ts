/**
 * Shared behavioural contract every {@link RevocationStore} backend must satisfy.
 *
 * Exercised against the in-memory and SQLite backends (and Postgres as an integration test) so
 * revoke/isRevoked semantics and idempotency are verified once rather than per backend.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { RevocationStore } from '../protocol/revocation-store.js';

/**
 * Register the {@link RevocationStore} contract for one backend.
 *
 * @param name - Label shown in the describe block.
 * @param makeStore - Factory yielding a fresh, empty store per test.
 */
export function revocationStoreContract(name: string, makeStore: () => Promise<RevocationStore>): void {
  describe(`RevocationStore contract: ${name}`, () => {
    let store: RevocationStore;
    beforeEach(async () => {
      store = await makeStore();
    });
    afterEach(async () => {
      await store.close();
    });

    test('an unknown receipt is not revoked', async () => {
      expect(await store.isRevoked('rcpt_x')).toBe(false);
    });

    test('revoke then isRevoked is true', async () => {
      await store.revoke('rcpt_x');
      expect(await store.isRevoked('rcpt_x')).toBe(true);
      expect(await store.isRevoked('rcpt_y')).toBe(false);
    });

    test('revoke is idempotent', async () => {
      await store.revoke('rcpt_x');
      await store.revoke('rcpt_x');
      expect(await store.isRevoked('rcpt_x')).toBe(true);
    });
  });
}
