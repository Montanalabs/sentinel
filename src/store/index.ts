/**
 * Public barrel for the provenance store subsystem.
 *
 * Re-exports the {@link ProvenanceStore} contract, the {@link ProvenanceFilter}
 * query shape, the three concrete backends ({@link InMemoryStore},
 * {@link SqliteStore}, {@link PostgresStore}), and the {@link openStore} factory.
 * Callers should resolve a backend through {@link openStore} rather than
 * constructing a driver directly, so the deployment's store URL is the single
 * configuration point.
 */

export type { ProvenanceStore, ProvenanceFilter } from './types.js';
export { DuplicateRecordError, NonMonotonicSeqError } from './errors.js';
export { InMemoryStore } from './memory.js';
export { PostgresStore } from './postgres.js';
export { SqliteStore } from './sqlite.js';
export { openStore } from './open-store.js';
