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

// Protocol replay-protection and receipt persistence (additive; not part of the provenance chain).
export type { NonceStore, NonceConsumeResult } from './nonce-store.js';
export { InMemoryNonceStore } from './nonce-memory.js';
export { SqliteNonceStore } from './nonce-sqlite.js';
export type { ReceiptStore } from './receipt-store.js';
export { InMemoryReceiptStore } from './receipt-memory.js';
export { SqliteReceiptStore } from './receipt-sqlite.js';
export type { ExecutionReceiptStore } from './execution-store.js';
export { InMemoryExecutionReceiptStore } from './execution-memory.js';
export { SqliteExecutionReceiptStore } from './execution-sqlite.js';
