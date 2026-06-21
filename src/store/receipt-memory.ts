/**
 * In-memory {@link ReceiptStore} (non-durable; for dev/test/single-process use).
 *
 * A `Map` keyed by `receiptId`, preserving insertion order for {@link InMemoryReceiptStore.list}.
 * Lost on restart — use the SQLite backend for any deployment whose audit log must survive a reboot.
 */

import type { AuthorizationReceipt } from '../protocol/authorization-receipt.js';
import type { ReceiptStore } from './receipt-store.js';

/** Process-local authorization-receipt store backed by a `Map`. */
export class InMemoryReceiptStore implements ReceiptStore {
  readonly #byId = new Map<string, AuthorizationReceipt>();

  async put(receipt: AuthorizationReceipt): Promise<void> {
    if (!this.#byId.has(receipt.receiptId)) this.#byId.set(receipt.receiptId, receipt);
  }

  async get(receiptId: string): Promise<AuthorizationReceipt | undefined> {
    return this.#byId.get(receiptId);
  }

  async list(): Promise<AuthorizationReceipt[]> {
    return [...this.#byId.values()];
  }

  async close(): Promise<void> {
    this.#byId.clear();
  }
}
