/**
 * SQLite-backed {@link RevocationStore}.
 *
 * Durable revocation list keyed by `receipt_id`; `revoke` is idempotent. Backed by Node's built-in
 * `node:sqlite`, so a revoked receipt survives a restart (unlike the in-memory list).
 */

import type { DatabaseSync as Db } from 'node:sqlite';
import type { RevocationStore } from '../protocol/revocation-store.js';
import { loadSqlite } from './sqlite-loader.js';

const DDL = `
CREATE TABLE IF NOT EXISTS revoked_receipts (
  receipt_id TEXT PRIMARY KEY,
  revoked_at TEXT NOT NULL
);
`;

/** Durable, single-node revocation store backed by `node:sqlite`. */
export class SqliteRevocationStore implements RevocationStore {
  private constructor(private readonly db: Db) {}

  /**
   * Open (or create) a SQLite-backed revocation store at `path`.
   *
   * @param path - SQLite file path; `:memory:` for an ephemeral store.
   * @param opts - `reset` drops all revocations on open (tests).
   * @returns A ready store with its schema ensured.
   */
  static async open(path: string, opts: { reset?: boolean } = {}): Promise<SqliteRevocationStore> {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(DDL);
    if (opts.reset) db.exec('DELETE FROM revoked_receipts');
    return new SqliteRevocationStore(db);
  }

  async revoke(receiptId: string): Promise<void> {
    this.db
      .prepare('INSERT INTO revoked_receipts (receipt_id, revoked_at) VALUES (?, ?) ON CONFLICT(receipt_id) DO NOTHING')
      .run(receiptId, new Date().toISOString());
  }

  async isRevoked(receiptId: string): Promise<boolean> {
    return this.db.prepare('SELECT 1 FROM revoked_receipts WHERE receipt_id = ?').get(receiptId) !== undefined;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
