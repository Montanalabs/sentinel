/**
 * In-memory {@link NonceStore} for dev/test and single-process deployments.
 *
 * Atomicity is free here: the Node event loop is single-threaded, so the read-modify-write in
 * {@link InMemoryNonceStore.consume} cannot interleave. Non-durable — consumed nonces are lost on
 * restart, which only matters for replay protection across process lifetimes (use SQLite/Postgres
 * for durability).
 */

import type { NonceConsumeResult, NonceStore } from './nonce-store.js';

/** Tracks per-nonce consumption count for {@link InMemoryNonceStore}. */
interface NonceEntry {
  count: number;
  receiptId: string;
}

/** Process-memory replay-protection store. */
export class InMemoryNonceStore implements NonceStore {
  private readonly nonces = new Map<string, NonceEntry>();

  async consume(receiptId: string, nonce: string, maxExecutions: number): Promise<NonceConsumeResult> {
    const entry = this.nonces.get(nonce);
    if (!entry) {
      this.nonces.set(nonce, { count: 1, receiptId });
      return { consumed: true, executionCount: 1 };
    }
    if (entry.count >= maxExecutions) {
      return { consumed: false, executionCount: entry.count };
    }
    entry.count += 1;
    return { consumed: true, executionCount: entry.count };
  }

  async close(): Promise<void> {
    this.nonces.clear();
  }
}
