/**
 * URL-keyed factory for the protocol's persistence trio: nonce, receipt, and execution stores.
 *
 * Resolves the same deployment store URL the provenance {@link openStore} uses to the matching
 * backend for the three protocol stores, so one configuration point drives all persistence. SQLite
 * uses the same database file as the provenance chain (separate tables); the in-memory backend is
 * used for dev/test. Postgres-backed protocol stores are not yet implemented — a `postgres://` URL
 * falls back to **non-durable in-memory** protocol stores with a loud warning, so enabling the
 * protocol never crashes boot but the operator is told the audit log will not survive a restart.
 */

import type { NonceStore } from './nonce-store.js';
import type { ReceiptStore } from './receipt-store.js';
import type { ExecutionReceiptStore } from './execution-store.js';
import { InMemoryNonceStore } from './nonce-memory.js';
import { SqliteNonceStore } from './nonce-sqlite.js';
import { InMemoryReceiptStore } from './receipt-memory.js';
import { SqliteReceiptStore } from './receipt-sqlite.js';
import { InMemoryExecutionReceiptStore } from './execution-memory.js';
import { SqliteExecutionReceiptStore } from './execution-sqlite.js';

/** The three persistence stores the adjudication protocol needs. */
export interface ProtocolStores {
  readonly nonces: NonceStore;
  readonly receipts: ReceiptStore;
  readonly executions: ExecutionReceiptStore;
}

/**
 * Resolve the protocol persistence trio from a store URL.
 *
 * @param url - The deployment store URL (same scheme as {@link openStore}); falsy selects in-memory.
 * @returns Ready nonce/receipt/execution stores with their schemas ensured.
 */
export async function openProtocolStores(url?: string): Promise<ProtocolStores> {
  if (url && url.startsWith('sqlite:')) {
    const path = url.slice('sqlite:'.length) || ':memory:';
    const [nonces, receipts, executions] = await Promise.all([
      SqliteNonceStore.open(path),
      SqliteReceiptStore.open(path),
      SqliteExecutionReceiptStore.open(path),
    ]);
    return { nonces, receipts, executions };
  }
  if (url && (url.startsWith('postgres://') || url.startsWith('postgresql://'))) {
    console.warn(
      '[sentinel] WARNING: protocol persistence over Postgres is not yet implemented — using ' +
        'NON-DURABLE in-memory receipt/execution/nonce stores. The protocol audit log will not ' +
        'survive a restart. Use a `sqlite:` store URL for durable single-node protocol persistence.',
    );
  }
  return { nonces: new InMemoryNonceStore(), receipts: new InMemoryReceiptStore(), executions: new InMemoryExecutionReceiptStore() };
}
