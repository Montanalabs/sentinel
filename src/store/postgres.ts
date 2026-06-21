/**
 * Postgres-backed implementation of the provenance store.
 *
 * Provides a durable, server-backed {@link ProvenanceStore} suited to
 * multi-writer and high-availability deployments. Records are stored one row
 * per {@link ProvenanceRecord} with the full record kept as JSONB and key
 * fields denormalised for indexed filtering. This is the production backend
 * resolved when the store URL uses a `postgres://` scheme.
 */

import pg from 'pg';
import type { ProvenanceRecord } from '../provenance/record.js';
import type { ProvenanceFilter, ProvenanceStore } from './types.js';
import { DuplicateRecordError, NonMonotonicSeqError } from './errors.js';
import { pgPool } from './pg-connect.js';

const DDL = `
CREATE TABLE IF NOT EXISTS provenance_records (
  id       TEXT PRIMARY KEY,
  seq      BIGINT NOT NULL UNIQUE,
  ts       TEXT NOT NULL,
  tenant   TEXT,
  run_id   TEXT NOT NULL,
  verdict  TEXT NOT NULL,
  record   JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS provenance_ts_idx ON provenance_records (ts);
CREATE INDEX IF NOT EXISTS provenance_tenant_idx ON provenance_records (tenant);
CREATE INDEX IF NOT EXISTS provenance_run_idx ON provenance_records (run_id);
`;

/**
 * Connection-time options for {@link PostgresStore.connect}.
 */
export interface PostgresStoreOptions {
  /** TRUNCATE the table on connect (tests only). */
  reset?: boolean;
}

/**
 * Durable, append-only {@link ProvenanceStore} backed by Postgres.
 *
 * Owns a connection {@link pg.Pool} and serves all chain reads/writes through
 * it. Construct instances via {@link PostgresStore.connect}; the private
 * constructor enforces that the schema has been ensured before use.
 */
export class PostgresStore implements ProvenanceStore {
  private constructor(private readonly pool: pg.Pool) {}

  /**
   * Connect to Postgres, ensure the schema, and return a ready store.
   *
   * @param url - A `postgres://`/`postgresql://` connection string.
   * @param opts - Connection options; {@link PostgresStoreOptions.reset}
   *   truncates the table (test fixtures only).
   * @returns A connected {@link PostgresStore} with its table and indexes in
   *   place.
   * @throws {Error} Propagated from the driver if the connection fails or the
   *   schema DDL (or the optional TRUNCATE) cannot be executed.
   */
  static async connect(url: string, opts: PostgresStoreOptions = {}): Promise<PostgresStore> {
    const pool = await pgPool(url, DDL);
    if (opts.reset) await pool.query('TRUNCATE provenance_records');
    return new PostgresStore(pool);
  }

  /**
   * Append a record to the chain.
   *
   * @param record - The {@link ProvenanceRecord} to persist; stored whole as
   *   JSONB with id/seq/ts/tenant/run_id/verdict denormalised.
   * @throws {DuplicateRecordError} When the insert violates the primary-key or
   *   unique-seq constraint (SQLSTATE `23505`).
   * @throws {NonMonotonicSeqError} When `seq` does not strictly exceed the current
   *   chain tail (a backfilled/out-of-order seq is rejected, not silently stored).
   * @throws {Error} Propagated from the driver for any other query failure
   *   (connection loss, I/O error).
   */
  async append(record: ProvenanceRecord): Promise<void> {
    let res;
    try {
      // Two layers protect the append-only chain: (1) the WHERE guard rejects a backfilled/
      // out-of-order seq (<= current max); (2) the UNIQUE(seq) constraint is what actually prevents
      // a fork under concurrent writers — two writers that both read max=N and insert N+1 can't both
      // win; the loser gets 23505 → DuplicateRecordError → the engine resyncs to tail and retries.
      res = await this.pool.query(
        `INSERT INTO provenance_records (id, seq, ts, tenant, run_id, verdict, record)
         SELECT $1, $2, $3, $4, $5, $6, $7
         WHERE $2 > COALESCE((SELECT MAX(seq) FROM provenance_records), -1)`,
        [
          record.id,
          record.seq,
          record.ts,
          record.tenant ?? null,
          record.context.runId,
          record.verdict,
          JSON.stringify(record),
        ],
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') throw new DuplicateRecordError(record.id);
      throw err;
    }
    if (res.rowCount === 0) {
      // The WHERE guard rejected it: seq did not exceed the current tail.
      const { rows } = await this.pool.query<{ max: number | null }>('SELECT MAX(seq) AS max FROM provenance_records');
      // BIGINT comes back as a string from node-postgres; coerce so the error carries a number.
      throw new NonMonotonicSeqError(record.seq, Number(rows[0]?.max ?? -1));
    }
  }

  /**
   * Look up a record by id.
   *
   * @returns The decoded {@link ProvenanceRecord}, or `null` if no row matches.
   * @throws {Error} Propagated from the driver if the query fails.
   */
  async getById(id: string): Promise<ProvenanceRecord | null> {
    const { rows } = await this.pool.query<{ record: ProvenanceRecord }>(
      'SELECT record FROM provenance_records WHERE id = $1',
      [id],
    );
    return rows[0]?.record ?? null;
  }

  /**
   * Compile a {@link ProvenanceFilter} into a parameterised `WHERE` clause.
   *
   * @param filter - The selection criteria (paging fields are ignored here).
   * @returns The SQL clause (empty string when no conditions) and its ordered
   *   bind parameters, with `$n` placeholders assigned in build order.
   */
  private buildWhere(filter: ProvenanceFilter): { clause: string; params: unknown[] } {
    const conds: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conds.push(sql.replace('?', `$${params.length}`));
    };
    if (filter.tenant !== undefined) add('tenant = ?', filter.tenant);
    if (filter.runId !== undefined) add('run_id = ?', filter.runId);
    if (filter.verdict !== undefined) add('verdict = ?', filter.verdict);
    if (filter.since !== undefined) add('ts >= ?', filter.since);
    if (filter.until !== undefined) add('ts < ?', filter.until);
    return { clause: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
  }

  /**
   * Return records matching the filter, in seq order, with paging applied.
   *
   * @param filter - Selection and paging criteria; see {@link ProvenanceFilter}.
   * @returns The matching {@link ProvenanceRecord}s, ascending by seq.
   * @throws {Error} Propagated from the driver if the query fails.
   */
  async query(filter: ProvenanceFilter = {}): Promise<ProvenanceRecord[]> {
    const { clause, params } = this.buildWhere(filter);
    let sql = `SELECT record FROM provenance_records ${clause} ORDER BY seq ASC`;
    if (filter.limit !== undefined) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    if (filter.offset !== undefined) {
      params.push(filter.offset);
      sql += ` OFFSET $${params.length}`;
    }
    const { rows } = await this.pool.query<{ record: ProvenanceRecord }>(sql, params);
    return rows.map((r) => r.record);
  }

  /**
   * Return the highest-seq record.
   *
   * @returns The tail {@link ProvenanceRecord}, or `null` if the table is empty.
   * @throws {Error} Propagated from the driver if the query fails.
   */
  async tail(): Promise<ProvenanceRecord | null> {
    const { rows } = await this.pool.query<{ record: ProvenanceRecord }>(
      'SELECT record FROM provenance_records ORDER BY seq DESC LIMIT 1',
    );
    return rows[0]?.record ?? null;
  }

  /**
   * Return the full chain in seq order.
   *
   * @returns Every {@link ProvenanceRecord}, ascending by seq.
   * @throws {Error} Propagated from the driver if the query fails.
   */
  async list(): Promise<ProvenanceRecord[]> {
    const { rows } = await this.pool.query<{ record: ProvenanceRecord }>(
      'SELECT record FROM provenance_records ORDER BY seq ASC',
    );
    return rows.map((r) => r.record);
  }

  /**
   * Count records matching the filter, ignoring paging.
   *
   * @param filter - Selection criteria; `limit`/`offset` are ignored. See
   *   {@link ProvenanceFilter}.
   * @returns The number of matching rows.
   * @throws {Error} Propagated from the driver if the query fails.
   */
  async count(filter: ProvenanceFilter = {}): Promise<number> {
    const { clause, params } = this.buildWhere(filter);
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM provenance_records ${clause}`,
      params,
    );
    return Number(rows[0]!.n);
  }

  /**
   * Close the connection pool, releasing all sockets.
   *
   * @throws {Error} Propagated from the driver if draining the pool fails.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
