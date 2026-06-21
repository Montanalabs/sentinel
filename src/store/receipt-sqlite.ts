/**
 * SQLite-backed {@link ReceiptStore}.
 *
 * Stores each receipt as its JSON body keyed by `receipt_id` (with `issued_at` retained for ordering
 * and inspection). `put` uses `ON CONFLICT(receipt_id) DO NOTHING` so a retried issuance is idempotent
 * and a stored receipt is never silently mutated. Backed by Node's built-in `node:sqlite` — durable
 * across restarts, no server.
 */

import type { DatabaseSync as Db } from 'node:sqlite';
import type { AuthorizationReceipt } from '../protocol/authorization-receipt.js';
import type { ReceiptStore } from './receipt-store.js';
import { loadSqlite } from './sqlite-loader.js';

const DDL = `
CREATE TABLE IF NOT EXISTS authorization_receipts (
  receipt_id TEXT PRIMARY KEY,
  issued_at  TEXT NOT NULL,
  body       TEXT NOT NULL
);
`;

/** Options for {@link SqliteReceiptStore.open}. */
export interface SqliteReceiptStoreOptions {
  /** Drop all stored receipts on open (tests). */
  readonly reset?: boolean;
}

/** Durable, single-node authorization-receipt store backed by `node:sqlite`. */
export class SqliteReceiptStore implements ReceiptStore {
  private constructor(private readonly db: Db) {}

  /**
   * Open (or create) a SQLite-backed receipt store at `path`.
   *
   * @param path - SQLite file path; `:memory:` for an ephemeral store.
   * @param opts - See {@link SqliteReceiptStoreOptions}.
   * @returns A ready store with its schema ensured.
   */
  static async open(path: string, opts: SqliteReceiptStoreOptions = {}): Promise<SqliteReceiptStore> {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(DDL);
    if (opts.reset) db.exec('DELETE FROM authorization_receipts');
    return new SqliteReceiptStore(db);
  }

  async put(receipt: AuthorizationReceipt): Promise<void> {
    this.db
      .prepare('INSERT INTO authorization_receipts (receipt_id, issued_at, body) VALUES (?, ?, ?) ON CONFLICT(receipt_id) DO NOTHING')
      .run(receipt.receiptId, receipt.issuedAt, JSON.stringify(receipt));
  }

  async get(receiptId: string): Promise<AuthorizationReceipt | undefined> {
    const row = this.db.prepare('SELECT body FROM authorization_receipts WHERE receipt_id = ?').get(receiptId) as
      | { body: string }
      | undefined;
    return row ? (JSON.parse(row.body) as AuthorizationReceipt) : undefined;
  }

  async list(): Promise<AuthorizationReceipt[]> {
    const rows = this.db.prepare('SELECT body FROM authorization_receipts ORDER BY rowid').all() as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as AuthorizationReceipt);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
