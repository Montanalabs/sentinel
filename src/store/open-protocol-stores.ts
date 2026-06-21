/**
 * URL-keyed factory for the protocol's persistence set: nonce, receipt, execution, and revocation
 * stores.
 *
 * Resolves the same deployment store URL the provenance {@link openStore} uses to the matching backend
 * for the protocol stores, so one configuration point drives all persistence. SQLite uses the same
 * database file as the provenance chain (separate tables); Postgres uses durable, multi-writer tables
 * on the same database — required for the HA topology, where every sidecar must share one nonce ledger
 * and one revocation list or the single-use / revocation guarantees degrade to per-instance. The
 * in-memory backend is dev/test only.
 */

import type { NonceStore } from './nonce-store.js';
import type { ReceiptStore } from './receipt-store.js';
import type { ExecutionReceiptStore } from './execution-store.js';
import type { RevocationStore } from '../protocol/revocation-store.js';
import { InMemoryRevocationStore } from '../protocol/revocation-store.js';
import { InMemoryNonceStore } from './nonce-memory.js';
import { SqliteNonceStore } from './nonce-sqlite.js';
import { PostgresNonceStore } from './nonce-postgres.js';
import { InMemoryReceiptStore } from './receipt-memory.js';
import { SqliteReceiptStore } from './receipt-sqlite.js';
import { PostgresReceiptStore } from './receipt-postgres.js';
import { InMemoryExecutionReceiptStore } from './execution-memory.js';
import { SqliteExecutionReceiptStore } from './execution-sqlite.js';
import { PostgresExecutionReceiptStore } from './execution-postgres.js';
import { SqliteRevocationStore } from './revocation-sqlite.js';
import { PostgresRevocationStore } from './revocation-postgres.js';

/** The persistence stores the adjudication protocol needs. */
export interface ProtocolStores {
  readonly nonces: NonceStore;
  readonly receipts: ReceiptStore;
  readonly executions: ExecutionReceiptStore;
  readonly revocations: RevocationStore;
}

/**
 * Resolve the protocol persistence set from a store URL.
 *
 * @param url - The deployment store URL (same scheme as {@link openStore}); falsy selects in-memory.
 * @returns Ready nonce/receipt/execution/revocation stores with their schemas ensured.
 */
export async function openProtocolStores(url?: string): Promise<ProtocolStores> {
  if (url && url.startsWith('sqlite:')) {
    const path = url.slice('sqlite:'.length) || ':memory:';
    const [nonces, receipts, executions, revocations] = await Promise.all([
      SqliteNonceStore.open(path),
      SqliteReceiptStore.open(path),
      SqliteExecutionReceiptStore.open(path),
      SqliteRevocationStore.open(path),
    ]);
    return { nonces, receipts, executions, revocations };
  }
  if (url && (url.startsWith('postgres://') || url.startsWith('postgresql://'))) {
    const [nonces, receipts, executions, revocations] = await Promise.all([
      PostgresNonceStore.connect(url),
      PostgresReceiptStore.connect(url),
      PostgresExecutionReceiptStore.connect(url),
      PostgresRevocationStore.connect(url),
    ]);
    return { nonces, receipts, executions, revocations };
  }
  return {
    nonces: new InMemoryNonceStore(),
    receipts: new InMemoryReceiptStore(),
    executions: new InMemoryExecutionReceiptStore(),
    revocations: new InMemoryRevocationStore(),
  };
}
