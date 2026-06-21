/**
 * Durable store of signed {@link ExecutionReceipt}s reported by executors.
 *
 * Closing the mediation loop requires the gate (or an external auditor) to see every execution that
 * claimed an authorization. Executors report their signed execution receipts here; the
 * complete-mediation audit reads them back alongside the authorization receipts to prove that each
 * execution maps to exactly one valid authorization for exactly that action. `put` is idempotent on
 * `executionId`. Backends mirror the provenance store's ports-and-adapters shape.
 */

import type { ExecutionReceipt } from '../protocol/execution-receipt.js';

/** Append-and-read store for execution receipts, keyed by `executionId`. */
export interface ExecutionReceiptStore {
  /**
   * Persist an execution receipt. Idempotent: a second `put` of the same `executionId` is a no-op.
   *
   * @param receipt - The signed execution receipt to persist.
   */
  put(receipt: ExecutionReceipt): Promise<void>;

  /**
   * List the executions reported against one authorization (used to detect replay).
   *
   * @param authorizationReceiptId - The authorization id to filter by.
   * @returns Every execution receipt referencing that authorization, in insertion order.
   */
  listByAuthorization(authorizationReceiptId: string): Promise<ExecutionReceipt[]>;

  /**
   * List all stored execution receipts in insertion order.
   *
   * @returns Every persisted execution receipt; intended for audit over a bounded history.
   */
  list(): Promise<ExecutionReceipt[]>;

  /** Release any underlying resources (connections, file handles). */
  close(): Promise<void>;
}
