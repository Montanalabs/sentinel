/**
 * SQLite-backed {@link ExecutionReceiptStore}.
 *
 * Stores each execution receipt as its JSON body keyed by `execution_id`, with
 * `authorization_receipt_id` indexed for the per-authorization lookup the replay check needs. `put`
 * uses `ON CONFLICT(execution_id) DO NOTHING` for idempotency. Backed by Node's built-in `node:sqlite`.
 */

import type { DatabaseSync as Db } from 'node:sqlite';
import type { ExecutionReceipt } from '../protocol/execution-receipt.js';
import type { ExecutionReceiptStore } from './execution-store.js';
import { loadSqlite } from './sqlite-loader.js';

const DDL = `
CREATE TABLE IF NOT EXISTS execution_receipts (
  execution_id             TEXT PRIMARY KEY,
  authorization_receipt_id TEXT NOT NULL,
  body                     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exec_auth ON execution_receipts(authorization_receipt_id);
`;

/** Options for {@link SqliteExecutionReceiptStore.open}. */
export interface SqliteExecutionReceiptStoreOptions {
  /** Drop all stored execution receipts on open (tests). */
  readonly reset?: boolean;
}

/** Durable, single-node execution-receipt store backed by `node:sqlite`. */
export class SqliteExecutionReceiptStore implements ExecutionReceiptStore {
  private constructor(private readonly db: Db) {}

  /**
   * Open (or create) a SQLite-backed execution-receipt store at `path`.
   *
   * @param path - SQLite file path; `:memory:` for an ephemeral store.
   * @param opts - See {@link SqliteExecutionReceiptStoreOptions}.
   * @returns A ready store with its schema ensured.
   */
  static async open(path: string, opts: SqliteExecutionReceiptStoreOptions = {}): Promise<SqliteExecutionReceiptStore> {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(DDL);
    if (opts.reset) db.exec('DELETE FROM execution_receipts');
    return new SqliteExecutionReceiptStore(db);
  }

  async put(receipt: ExecutionReceipt): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO execution_receipts (execution_id, authorization_receipt_id, body) VALUES (?, ?, ?) ON CONFLICT(execution_id) DO NOTHING',
      )
      .run(receipt.executionId, receipt.authorizationReceiptId, JSON.stringify(receipt));
  }

  async listByAuthorization(authorizationReceiptId: string): Promise<ExecutionReceipt[]> {
    const rows = this.db
      .prepare('SELECT body FROM execution_receipts WHERE authorization_receipt_id = ? ORDER BY rowid')
      .all(authorizationReceiptId) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as ExecutionReceipt);
  }

  async list(): Promise<ExecutionReceipt[]> {
    const rows = this.db.prepare('SELECT body FROM execution_receipts ORDER BY rowid').all() as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as ExecutionReceipt);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
