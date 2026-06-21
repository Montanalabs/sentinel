/**
 * Postgres-backed {@link RevocationStore} for durable, multi-writer revocation.
 *
 * In the HA topology every sidecar must see the same revocations, or a receipt revoked on one replica
 * would still validate on another. `revoke` is idempotent via `ON CONFLICT (receipt_id) DO NOTHING`.
 */

import pg from 'pg';
import type { RevocationStore } from '../protocol/revocation-store.js';
import { pgPool } from './pg-connect.js';

const DDL = `
CREATE TABLE IF NOT EXISTS revoked_receipts (
  receipt_id TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** Durable, multi-writer revocation store backed by Postgres. */
export class PostgresRevocationStore implements RevocationStore {
  private constructor(private readonly pool: pg.Pool) {}

  /**
   * Connect to Postgres and ensure the revocation schema exists (with bounded connect retry).
   *
   * @param url - A `postgres://` connection string.
   * @param opts - `reset` truncates the table on connect (tests only).
   * @returns A ready store.
   */
  static async connect(url: string, opts: { reset?: boolean } = {}): Promise<PostgresRevocationStore> {
    const pool = await pgPool(url, DDL);
    if (opts.reset) await pool.query('TRUNCATE revoked_receipts');
    return new PostgresRevocationStore(pool);
  }

  async revoke(receiptId: string): Promise<void> {
    await this.pool.query('INSERT INTO revoked_receipts (receipt_id) VALUES ($1) ON CONFLICT (receipt_id) DO NOTHING', [receiptId]);
  }

  async isRevoked(receiptId: string): Promise<boolean> {
    const res = await this.pool.query('SELECT 1 FROM revoked_receipts WHERE receipt_id = $1', [receiptId]);
    return (res.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
