/**
 * SQLite-backed {@link NonceStore}.
 *
 * Replay protection is enforced at the database level: a single atomic
 * `INSERT … ON CONFLICT … DO UPDATE SET count = count + 1 WHERE count < :max` claims an execution
 * slot only while one remains, so even concurrent executors of the same receipt cannot both consume
 * the final slot. Backed by Node's built-in `node:sqlite` — durable across restarts, no server.
 */

import type { DatabaseSync as Db } from 'node:sqlite';
import type { NonceConsumeResult, NonceStore } from './nonce-store.js';
import { loadSqlite } from './sqlite-loader.js';

const DDL = `
CREATE TABLE IF NOT EXISTS receipt_nonces (
  nonce             TEXT PRIMARY KEY,
  receipt_id        TEXT NOT NULL,
  count             INTEGER NOT NULL,
  first_consumed_at TEXT NOT NULL
);
`;

/** Options for {@link SqliteNonceStore.open}. */
export interface SqliteNonceStoreOptions {
  /** Drop all consumed-nonce state on open (tests). */
  readonly reset?: boolean;
}

/** Durable, single-node replay-protection store backed by `node:sqlite`. */
export class SqliteNonceStore implements NonceStore {
  private constructor(private readonly db: Db) {}

  /**
   * Open (or create) a SQLite-backed nonce store at `path`.
   *
   * @param path - SQLite file path; `:memory:` for an ephemeral store.
   * @param opts - See {@link SqliteNonceStoreOptions}.
   * @returns A ready store with its schema ensured.
   */
  static async open(path: string, opts: SqliteNonceStoreOptions = {}): Promise<SqliteNonceStore> {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(DDL);
    if (opts.reset) db.exec('DELETE FROM receipt_nonces');
    return new SqliteNonceStore(db);
  }

  async consume(receiptId: string, nonce: string, maxExecutions: number): Promise<NonceConsumeResult> {
    // Atomic claim: insert the first execution, or increment only while below the cap. RETURNING
    // yields the new count when a slot is claimed, and nothing when the cap is already reached.
    const row = this.db
      .prepare(
        `INSERT INTO receipt_nonces (nonce, receipt_id, count, first_consumed_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(nonce) DO UPDATE SET count = count + 1 WHERE count < ?
         RETURNING count`,
      )
      .get(nonce, receiptId, new Date().toISOString(), maxExecutions) as { count: number } | undefined;

    if (row) return { consumed: true, executionCount: Number(row.count) };

    const cur = this.db.prepare('SELECT count FROM receipt_nonces WHERE nonce = ?').get(nonce) as
      | { count: number }
      | undefined;
    return { consumed: false, executionCount: Number(cur?.count ?? maxExecutions) };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
