/**
 * Postgres-backed {@link ExecutionReceiptStore} for durable, multi-writer execution persistence.
 *
 * Shares the same HA rationale as the Postgres receipt store: every sidecar must report executions to
 * one durable log so the complete-mediation audit sees the whole picture. `put` is idempotent via
 * `ON CONFLICT (execution_id) DO NOTHING`; `authorization_receipt_id` is indexed for the
 * per-authorization lookup the replay check needs.
 */

import pg from 'pg';
import type { ExecutionReceipt } from '../protocol/execution-receipt.js';
import type { ExecutionReceiptStore } from './execution-store.js';
import { pgPool } from './pg-connect.js';

const DDL = `
CREATE TABLE IF NOT EXISTS execution_receipts (
  seq                      BIGSERIAL,
  execution_id             TEXT PRIMARY KEY,
  authorization_receipt_id TEXT NOT NULL,
  body                     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exec_auth ON execution_receipts(authorization_receipt_id);
`;

/** Durable, multi-writer execution-receipt store backed by Postgres. */
export class PostgresExecutionReceiptStore implements ExecutionReceiptStore {
  private constructor(private readonly pool: pg.Pool) {}

  /**
   * Connect to Postgres and ensure the execution-receipt schema exists.
   *
   * @param url - A `postgres://` connection string.
   * @param opts - `reset` truncates the table on connect (tests only).
   * @returns A ready store.
   */
  static async connect(url: string, opts: { reset?: boolean } = {}): Promise<PostgresExecutionReceiptStore> {
    const pool = await pgPool(url, DDL);
    if (opts.reset) await pool.query('TRUNCATE execution_receipts');
    return new PostgresExecutionReceiptStore(pool);
  }

  async put(receipt: ExecutionReceipt): Promise<void> {
    await this.pool.query(
      'INSERT INTO execution_receipts (execution_id, authorization_receipt_id, body) VALUES ($1, $2, $3) ON CONFLICT (execution_id) DO NOTHING',
      [receipt.executionId, receipt.authorizationReceiptId, JSON.stringify(receipt)],
    );
  }

  async listByAuthorization(authorizationReceiptId: string): Promise<ExecutionReceipt[]> {
    const res = await this.pool.query<{ body: string }>(
      'SELECT body FROM execution_receipts WHERE authorization_receipt_id = $1 ORDER BY seq',
      [authorizationReceiptId],
    );
    return res.rows.map((r) => JSON.parse(r.body) as ExecutionReceipt);
  }

  async list(): Promise<ExecutionReceipt[]> {
    const res = await this.pool.query<{ body: string }>('SELECT body FROM execution_receipts ORDER BY seq');
    return res.rows.map((r) => JSON.parse(r.body) as ExecutionReceipt);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
