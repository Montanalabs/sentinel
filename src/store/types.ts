/**
 * Storage contract for the provenance ledger.
 *
 * Defines the {@link ProvenanceStore} interface every backend (in-memory,
 * SQLite, Postgres) implements, plus the {@link ProvenanceFilter} used to slice
 * the chain. This module is the seam between the provenance subsystem and any
 * durable backing store: callers depend on these types, never on a concrete
 * driver.
 */

import type { ProvenanceRecord } from '../provenance/record.js';
import type { Verdict } from '../core/types.js';

/**
 * Selection criteria for querying and counting provenance records.
 *
 * All fields are optional and combine with AND semantics; an empty filter
 * matches the whole chain. Filters operate against the persisted
 * {@link ProvenanceRecord} fields.
 *
 * @remarks Paging (`limit`/`offset`) applies after filtering and assumes seq
 *   ascending order. The time window is half-open: `[since, until)`.
 */
export interface ProvenanceFilter {
  /** Match records owned by this tenant; omit to match any tenant. */
  tenant?: string;
  /** Match records produced within this run/correlation id. */
  runId?: string;
  /** Match records carrying this {@link Verdict}. */
  verdict?: Verdict;
  /** Inclusive lower bound on ts (ISO string). */
  since?: string;
  /** Exclusive upper bound on ts (ISO string). */
  until?: string;
  /** Maximum number of records to return; omit for no cap. */
  limit?: number;
  /** Number of leading records to skip (seq order) before returning. */
  offset?: number;
}

/**
 * Append-only persistence for the provenance chain.
 *
 * Implementations must preserve insertion (seq) order, reject out-of-order or
 * duplicate writes, and never mutate or delete stored records — the chain is
 * the tamper-evident audit log. Concrete backends include the in-memory,
 * SQLite, and Postgres stores; obtain one via the module's `openStore` factory.
 *
 * @remarks Every method may surface backend I/O failures (connection loss, disk
 *   errors); callers that need to fail safely must handle those.
 */
export interface ProvenanceStore {
  /**
   * Persist a record at the tail of the chain.
   *
   * @param record - The signed {@link ProvenanceRecord} to append; its `seq`
   *   must be strictly greater than the current tail's.
   * @throws {Error} If a record with the same id already exists.
   * @throws {Error} If `seq` is not strictly monotonic over the existing tail.
   */
  append(record: ProvenanceRecord): Promise<void>;
  /**
   * Look up a single record by its id.
   *
   * @returns The matching {@link ProvenanceRecord}, or `null` if no record has
   *   that id.
   */
  getById(id: string): Promise<ProvenanceRecord | null>;
  /**
   * Filtered query, ordered by seq ascending.
   *
   * @param filter - Selection and paging criteria; defaults to matching the
   *   whole chain. See {@link ProvenanceFilter}.
   * @returns The matching records in seq order, after applying `limit`/`offset`.
   */
  query(filter?: ProvenanceFilter): Promise<ProvenanceRecord[]>;
  /**
   * Highest-seq record, used to resume the chain after restart.
   *
   * @returns The current tail {@link ProvenanceRecord}, or `null` if the chain
   *   is empty.
   */
  tail(): Promise<ProvenanceRecord | null>;
  /**
   * Full chain in seq order, for verification or export.
   *
   * @returns Every {@link ProvenanceRecord} in ascending seq order.
   */
  list(): Promise<ProvenanceRecord[]>;
  /**
   * Count records matching a filter, ignoring paging.
   *
   * @param filter - Selection criteria; `limit`/`offset` are ignored. See
   *   {@link ProvenanceFilter}.
   * @returns The number of matching records.
   */
  count(filter?: ProvenanceFilter): Promise<number>;
  /**
   * Release backend resources (connections, file handles).
   *
   * @remarks Idempotent for in-memory stores; required for durable backends to
   *   avoid leaking connections.
   */
  close(): Promise<void>;
}
