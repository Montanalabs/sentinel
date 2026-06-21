/**
 * In-memory implementation of the provenance store.
 *
 * Provides a non-durable {@link ProvenanceStore} backed by process memory,
 * used for unit tests and local development where no database is configured.
 * It enforces the same id-uniqueness and seq-monotonicity invariants as the
 * durable backends so the {@link ProvenanceStore} contract behaves identically.
 */

import type { ProvenanceRecord } from '../provenance/record.js';
import type { ProvenanceFilter, ProvenanceStore } from './types.js';
import { DuplicateRecordError, NonMonotonicSeqError } from './errors.js';

/**
 * Test whether a record satisfies every set field of a filter.
 *
 * @param r - The candidate {@link ProvenanceRecord}.
 * @param f - The {@link ProvenanceFilter}; unset fields are wildcards and the
 *   `until` bound is exclusive.
 * @returns `true` when the record matches all set criteria.
 */
function matches(r: ProvenanceRecord, f: ProvenanceFilter): boolean {
  if (f.tenant !== undefined && r.tenant !== f.tenant) return false;
  if (f.runId !== undefined && r.context.runId !== f.runId) return false;
  if (f.verdict !== undefined && r.verdict !== f.verdict) return false;
  if (f.since !== undefined && r.ts < f.since) return false;
  if (f.until !== undefined && r.ts >= f.until) return false;
  return true;
}

/**
 * Non-durable, in-process {@link ProvenanceStore} for tests and development.
 *
 * Records live only for the lifetime of the process; nothing is persisted.
 * Reads return the same object instances that were appended (no
 * serialisation), so callers must treat results as shared, immutable records.
 */
export class InMemoryStore implements ProvenanceStore {
  private readonly byId = new Map<string, ProvenanceRecord>();
  private readonly ordered: ProvenanceRecord[] = [];

  /**
   * Append a record to the in-memory chain.
   *
   * @param record - The {@link ProvenanceRecord} to store; its `seq` must
   *   exceed the current tail's.
   * @throws {DuplicateRecordError} If a record with the same id is already present.
   * @throws {NonMonotonicSeqError} If `seq` is not strictly greater than the
   *   current tail's.
   */
  async append(record: ProvenanceRecord): Promise<void> {
    if (this.byId.has(record.id)) throw new DuplicateRecordError(record.id);
    const tail = this.ordered[this.ordered.length - 1];
    if (tail && record.seq <= tail.seq) {
      throw new NonMonotonicSeqError(record.seq, tail.seq);
    }
    this.byId.set(record.id, record);
    this.ordered.push(record);
  }

  /**
   * Look up a record by id.
   *
   * @returns The stored {@link ProvenanceRecord}, or `null` if absent.
   */
  async getById(id: string): Promise<ProvenanceRecord | null> {
    return this.byId.get(id) ?? null;
  }

  /**
   * Return records matching the filter, in seq order, with paging applied.
   *
   * @param filter - Selection and paging criteria; see {@link ProvenanceFilter}.
   * @returns The matching {@link ProvenanceRecord}s after `offset`/`limit`.
   */
  async query(filter: ProvenanceFilter = {}): Promise<ProvenanceRecord[]> {
    const all = this.ordered.filter((r) => matches(r, filter));
    const offset = filter.offset ?? 0;
    const end = filter.limit !== undefined ? offset + filter.limit : undefined;
    return all.slice(offset, end);
  }

  /**
   * Return the highest-seq record.
   *
   * @returns The tail {@link ProvenanceRecord}, or `null` if the chain is empty.
   */
  async tail(): Promise<ProvenanceRecord | null> {
    return this.ordered[this.ordered.length - 1] ?? null;
  }

  /**
   * Return the full chain in seq order.
   *
   * @returns A shallow copy of every {@link ProvenanceRecord}, ascending by seq.
   */
  async list(): Promise<ProvenanceRecord[]> {
    return [...this.ordered];
  }

  /**
   * Count records matching the filter, ignoring paging.
   *
   * @param filter - Selection criteria; `limit`/`offset` are ignored. See
   *   {@link ProvenanceFilter}.
   * @returns The number of matching records.
   */
  async count(filter: ProvenanceFilter = {}): Promise<number> {
    return this.ordered.filter((r) => matches(r, filter)).length;
  }

  /**
   * Release resources.
   *
   * @remarks No-op: the in-memory store holds no external handles.
   */
  async close(): Promise<void> {
    /* no-op */
  }
}
