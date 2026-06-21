/**
 * Typed, backend-agnostic errors for the provenance store subsystem.
 *
 * Every {@link ProvenanceStore} backend (in-memory, SQLite, Postgres) signals an append conflict
 * with the SAME error type and message, so callers (notably {@link Engine}) can detect a
 * conflicting write uniformly instead of pattern-matching backend-specific driver strings.
 */

/**
 * Thrown by {@link ProvenanceStore.append} when a record's `id` or `seq` already exists.
 *
 * The chain is append-only with unique `id` and strictly increasing `seq`; a duplicate of either
 * is a conflict the caller must resolve (it usually means a provenance replay/race). The
 * message intentionally contains the words "duplicate record id or seq" so message-based
 * detection remains stable across backends.
 */
export class DuplicateRecordError extends Error {
  constructor(readonly recordId: string) {
    super(`duplicate record id or seq: ${recordId}`);
    this.name = 'DuplicateRecordError';
  }
}

/**
 * Thrown by {@link ProvenanceStore.append} when a record's `seq` does not strictly exceed the
 * current chain tail, which would break the monotonic, hash-chained ordering.
 *
 * The message intentionally contains "non-monotonic seq" so message-based detection stays stable.
 */
export class NonMonotonicSeqError extends Error {
  constructor(
    readonly seq: number,
    readonly tailSeq: number,
  ) {
    super(`non-monotonic seq: ${seq} <= ${tailSeq}`);
    this.name = 'NonMonotonicSeqError';
  }
}
