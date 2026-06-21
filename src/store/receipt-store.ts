/**
 * Durable store of issued {@link AuthorizationReceipt}s.
 *
 * The gate persists every receipt it issues so the complete-mediation audit (and a later validator or
 * external auditor) can resolve an execution's `authorizationReceiptId` back to the exact receipt that
 * authorized it. Receipts are immutable once issued: {@link ReceiptStore.put} is idempotent on
 * `receiptId` and never overwrites an existing receipt. Backends mirror the provenance store's
 * ports-and-adapters shape (in-memory for dev/test, SQLite for durable single-node).
 */

import type { AuthorizationReceipt } from '../protocol/authorization-receipt.js';

/** Append-and-read store for authorization receipts, keyed by `receiptId`. */
export interface ReceiptStore {
  /**
   * Persist a receipt. Idempotent: a second `put` of the same `receiptId` is a no-op, so a retried
   * issuance never duplicates or mutates a stored receipt.
   *
   * @param receipt - The signed receipt to persist.
   */
  put(receipt: AuthorizationReceipt): Promise<void>;

  /**
   * Fetch a receipt by id.
   *
   * @param receiptId - The receipt id to look up.
   * @returns The stored receipt, or `undefined` if none was issued under that id.
   */
  get(receiptId: string): Promise<AuthorizationReceipt | undefined>;

  /**
   * List all stored receipts in issuance (insertion) order.
   *
   * @returns Every persisted receipt; intended for audit over a bounded history.
   */
  list(): Promise<AuthorizationReceipt[]>;

  /** Release any underlying resources (connections, file handles). */
  close(): Promise<void>;
}
