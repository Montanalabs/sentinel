/**
 * Postgres-backed {@link NonceStore} for durable, multi-writer replay protection.
 *
 * The single-use guarantee is enforced by one atomic statement:
 * `INSERT … ON CONFLICT (nonce) DO UPDATE SET count = count + 1 WHERE count < $max RETURNING count`.
 * Under concurrent executors of the same receipt, Postgres serializes the conflicting upserts on
 * the primary key, so at most `maxExecutions` of them can claim a slot — no application-level lock.
 */

import pg from 'pg';
import type { NonceConsumeResult, NonceStore } from './nonce-store.js';
import { pgPool } from './pg-connect.js';

const DDL = `
CREATE TABLE IF NOT EXISTS receipt_nonces (
  nonce             TEXT PRIMARY KEY,
  receipt_id        TEXT NOT NULL,
  count             INTEGER NOT NULL,
  first_consumed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** Durable, multi-writer replay-protection store backed by Postgres. */
export class PostgresNonceStore implements NonceStore {
  private constructor(private readonly pool: pg.Pool) {}

  /**
   * Connect to Postgres and ensure the nonce schema exists.
   *
   * @param url - A `postgres://` connection string.
   * @returns A ready store.
   * @throws Propagated from the driver if the connection or DDL fails.
   */
  static async connect(url: string, opts: { reset?: boolean } = {}): Promise<PostgresNonceStore> {
    const pool = await pgPool(url, DDL);
    if (opts.reset) await pool.query('TRUNCATE receipt_nonces');
    return new PostgresNonceStore(pool);
  }

  async consume(receiptId: string, nonce: string, maxExecutions: number): Promise<NonceConsumeResult> {
    const res = await this.pool.query<{ count: number }>(
      `INSERT INTO receipt_nonces (nonce, receipt_id, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (nonce) DO UPDATE SET count = receipt_nonces.count + 1
         WHERE receipt_nonces.count < $3
       RETURNING count`,
      [nonce, receiptId, maxExecutions],
    );
    if (res.rows[0]) return { consumed: true, executionCount: Number(res.rows[0].count) };

    const cur = await this.pool.query<{ count: number }>('SELECT count FROM receipt_nonces WHERE nonce = $1', [nonce]);
    return { consumed: false, executionCount: Number(cur.rows[0]?.count ?? maxExecutions) };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
