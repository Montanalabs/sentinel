/**
 * In-memory {@link ExecutionReceiptStore} (non-durable; for dev/test/single-process use).
 *
 * A `Map` keyed by `executionId`, preserving insertion order. Lost on restart — use the SQLite
 * backend for any deployment whose audit log must survive a reboot.
 */

import type { ExecutionReceipt } from '../protocol/execution-receipt.js';
import type { ExecutionReceiptStore } from './execution-store.js';

/** Process-local execution-receipt store backed by a `Map`. */
export class InMemoryExecutionReceiptStore implements ExecutionReceiptStore {
  readonly #byId = new Map<string, ExecutionReceipt>();

  async put(receipt: ExecutionReceipt): Promise<void> {
    if (!this.#byId.has(receipt.executionId)) this.#byId.set(receipt.executionId, receipt);
  }

  async listByAuthorization(authorizationReceiptId: string): Promise<ExecutionReceipt[]> {
    return [...this.#byId.values()].filter((e) => e.authorizationReceiptId === authorizationReceiptId);
  }

  async list(): Promise<ExecutionReceipt[]> {
    return [...this.#byId.values()];
  }

  async close(): Promise<void> {
    this.#byId.clear();
  }
}
