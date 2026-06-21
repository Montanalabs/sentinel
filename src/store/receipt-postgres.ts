/**
 * Postgres-backed {@link ReceiptStore} for durable, multi-writer receipt persistence.
 *
 * The HA topology (multiple sidecars behind a load balancer sharing one Postgres) needs the
 * authorization-receipt log to be shared and durable; the in-memory backend would give each instance
 * its own log. `put` is idempotent via `ON CONFLICT (receipt_id) DO NOTHING`; a `BIGSERIAL seq`
 * preserves issuance order for {@link list}.
 */

import pg from 'pg';
import type { AuthorizationReceipt } from '../protocol/authorization-receipt.js';
import type { ReceiptStore } from './receipt-store.js';

const DDL = `
CREATE TABLE IF NOT EXISTS authorization_receipts (
  seq        BIGSERIAL,
  receipt_id TEXT PRIMARY KEY,
  issued_at  TEXT NOT NULL,
  body       TEXT NOT NULL
);
`;

/** Durable, multi-writer authorization-receipt store backed by Postgres. */
export class PostgresReceiptStore implements ReceiptStore {
  private constructor(private readonly pool: pg.Pool) {}

  /**
   * Connect to Postgres and ensure the receipt schema exists.
   *
   * @param url - A `postgres://` connection string.
   * @param opts - `reset` truncates the table on connect (tests only).
   * @returns A ready store.
   */
  static async connect(url: string, opts: { reset?: boolean } = {}): Promise<PostgresReceiptStore> {
    const pool = new pg.Pool({ connectionString: url });
    await pool.query(DDL);
    if (opts.reset) await pool.query('TRUNCATE authorization_receipts');
    return new PostgresReceiptStore(pool);
  }

  async put(receipt: AuthorizationReceipt): Promise<void> {
    await this.pool.query(
      'INSERT INTO authorization_receipts (receipt_id, issued_at, body) VALUES ($1, $2, $3) ON CONFLICT (receipt_id) DO NOTHING',
      [receipt.receiptId, receipt.issuedAt, JSON.stringify(receipt)],
    );
  }

  async get(receiptId: string): Promise<AuthorizationReceipt | undefined> {
    const res = await this.pool.query<{ body: string }>('SELECT body FROM authorization_receipts WHERE receipt_id = $1', [receiptId]);
    return res.rows[0] ? (JSON.parse(res.rows[0].body) as AuthorizationReceipt) : undefined;
  }

  async list(): Promise<AuthorizationReceipt[]> {
    const res = await this.pool.query<{ body: string }>('SELECT body FROM authorization_receipts ORDER BY seq');
    return res.rows.map((r) => JSON.parse(r.body) as AuthorizationReceipt);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
