/**
 * SQLite-backed implementation of the provenance store.
 *
 * Provides a durable, single-node {@link ProvenanceStore} using Node's built-in
 * `node:sqlite` driver — no native module to compile and no separate database
 * server. This is the recommended backend for self-hosted, single-writer
 * deployments and is resolved when the store URL uses a `sqlite:` scheme;
 * `:memory:` yields an ephemeral store for tests.
 */

import type { DatabaseSync as Db, SQLInputValue } from 'node:sqlite';
import type { ProvenanceRecord } from '../provenance/record.js';
import type { ProvenanceFilter, ProvenanceStore } from './types.js';
import { DuplicateRecordError, NonMonotonicSeqError } from './errors.js';
import { loadSqlite } from './sqlite-loader.js';

const DDL = `
CREATE TABLE IF NOT EXISTS provenance_records (
  id      TEXT PRIMARY KEY,
  seq     INTEGER NOT NULL UNIQUE,
  ts      TEXT NOT NULL,
  tenant  TEXT,
  run_id  TEXT NOT NULL,
  verdict TEXT NOT NULL,
  record  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS provenance_ts_idx ON provenance_records (ts);
CREATE INDEX IF NOT EXISTS provenance_tenant_idx ON provenance_records (tenant);
CREATE INDEX IF NOT EXISTS provenance_run_idx ON provenance_records (run_id);
`;

/**
 * Open-time options for {@link SqliteStore.open}.
 */
export interface SqliteStoreOptions {
  /** Delete all rows on open (tests only). */
  reset?: boolean;
}

/**
 * Durable, single-node {@link ProvenanceStore} backed by SQLite.
 *
 * Uses Node's built-in `node:sqlite` driver (no native dependency), making it
 * ideal for self-hosting without running a separate database. Records are kept
 * one row each with the full {@link ProvenanceRecord} serialised as JSON text
 * and key fields denormalised for indexed filtering. Construct via
 * {@link SqliteStore.open}; `:memory:` yields an ephemeral store for tests.
 */
export class SqliteStore implements ProvenanceStore {
  private constructor(private readonly db: Db) {}

  /**
   * Open (or create) a SQLite database, ensure the schema, and return a store.
   *
   * @param path - Filesystem path to the database, or `:memory:` for an
   *   ephemeral in-process database. Enables WAL journaling for durability.
   * @param opts - Open options; {@link SqliteStoreOptions.reset} clears all rows
   *   (test fixtures only).
   * @returns A ready {@link SqliteStore} with its table and indexes in place.
   * @throws {Error} Propagated from {@link loadSqlite} if `node:sqlite` is
   *   unavailable.
   * @throws {Error} Propagated from the driver if the database cannot be opened
   *   or the schema DDL fails.
   */
  static async open(path: string, opts: SqliteStoreOptions = {}): Promise<SqliteStore> {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(DDL);
    if (opts.reset) db.exec('DELETE FROM provenance_records');
    return new SqliteStore(db);
  }

  /**
   * Append a record to the chain.
   *
   * @param record - The {@link ProvenanceRecord} to persist; stored whole as
   *   JSON text with id/seq/ts/tenant/run_id/verdict denormalised.
   * @throws {DuplicateRecordError} When the insert hits a UNIQUE constraint
   *   (id primary key or unique seq).
   * @throws {NonMonotonicSeqError} When `seq` does not strictly exceed the current
   *   chain tail (a backfilled/out-of-order seq is rejected, not silently stored).
   * @throws {Error} Propagated from the driver for any other insert failure.
   */
  async append(record: ProvenanceRecord): Promise<void> {
    let changes: number | bigint;
    try {
      // Insert only if seq strictly exceeds the current max — atomic guard against an
      // out-of-order/backfilled seq corrupting the append-only chain.
      const res = this.db
        .prepare(
          `INSERT INTO provenance_records (id, seq, ts, tenant, run_id, verdict, record)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE ? > COALESCE((SELECT MAX(seq) FROM provenance_records), -1)`,
        )
        .run(
          record.id,
          record.seq,
          record.ts,
          record.tenant ?? null,
          record.context.runId,
          record.verdict,
          JSON.stringify(record),
          record.seq,
        );
      changes = res.changes;
    } catch (err) {
      if (/UNIQUE constraint failed/.test((err as Error).message)) {
        throw new DuplicateRecordError(record.id);
      }
      throw err;
    }
    if (Number(changes) === 0) {
      const row = this.db.prepare('SELECT MAX(seq) AS max FROM provenance_records').get() as { max: number | null };
      throw new NonMonotonicSeqError(record.seq, row.max ?? -1);
    }
  }

  /**
   * Look up a record by id.
   *
   * @returns The decoded {@link ProvenanceRecord}, or `null` if no row matches.
   * @throws {SyntaxError} If a stored row holds malformed JSON (corruption).
   */
  async getById(id: string): Promise<ProvenanceRecord | null> {
    const row = this.db.prepare('SELECT record FROM provenance_records WHERE id = ?').get(id) as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as ProvenanceRecord) : null;
  }

  /**
   * Compile a {@link ProvenanceFilter} into a parameterised `WHERE` clause.
   *
   * @param filter - The selection criteria (paging fields are ignored here).
   * @returns The SQL clause (empty string when no conditions) and its positional
   *   bind parameters in clause order.
   */
  private where(filter: ProvenanceFilter): { clause: string; params: SQLInputValue[] } {
    const conds: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.tenant !== undefined) (conds.push('tenant = ?'), params.push(filter.tenant));
    if (filter.runId !== undefined) (conds.push('run_id = ?'), params.push(filter.runId));
    if (filter.verdict !== undefined) (conds.push('verdict = ?'), params.push(filter.verdict));
    if (filter.since !== undefined) (conds.push('ts >= ?'), params.push(filter.since));
    if (filter.until !== undefined) (conds.push('ts < ?'), params.push(filter.until));
    return { clause: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
  }

  /**
   * Return records matching the filter, in seq order, with paging applied.
   *
   * @param filter - Selection and paging criteria; see {@link ProvenanceFilter}.
   * @returns The matching {@link ProvenanceRecord}s, ascending by seq.
   * @throws {SyntaxError} If a stored row holds malformed JSON (corruption).
   * @remarks SQLite requires a `LIMIT` before `OFFSET`, so a lone `offset` is
   *   paired with `LIMIT -1` (unbounded) internally.
   */
  async query(filter: ProvenanceFilter = {}): Promise<ProvenanceRecord[]> {
    const { clause, params } = this.where(filter);
    let sql = `SELECT record FROM provenance_records ${clause} ORDER BY seq ASC`;
    if (filter.limit !== undefined) (sql += ' LIMIT ?', params.push(filter.limit));
    if (filter.offset !== undefined) {
      if (filter.limit === undefined) (sql += ' LIMIT -1', void 0); // SQLite requires LIMIT before OFFSET
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }
    const rows = this.db.prepare(sql).all(...params) as Array<{ record: string }>;
    return rows.map((r) => JSON.parse(r.record) as ProvenanceRecord);
  }

  /**
   * Return the highest-seq record.
   *
   * @returns The tail {@link ProvenanceRecord}, or `null` if the table is empty.
   * @throws {SyntaxError} If the stored row holds malformed JSON (corruption).
   */
  async tail(): Promise<ProvenanceRecord | null> {
    const row = this.db.prepare('SELECT record FROM provenance_records ORDER BY seq DESC LIMIT 1').get() as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as ProvenanceRecord) : null;
  }

  /**
   * Return the full chain in seq order.
   *
   * @returns Every {@link ProvenanceRecord}, ascending by seq.
   * @throws {SyntaxError} If any stored row holds malformed JSON (corruption).
   */
  async list(): Promise<ProvenanceRecord[]> {
    const rows = this.db.prepare('SELECT record FROM provenance_records ORDER BY seq ASC').all() as Array<{ record: string }>;
    return rows.map((r) => JSON.parse(r.record) as ProvenanceRecord);
  }

  /**
   * Count records matching the filter, ignoring paging.
   *
   * @param filter - Selection criteria; `limit`/`offset` are ignored. See
   *   {@link ProvenanceFilter}.
   * @returns The number of matching rows.
   */
  async count(filter: ProvenanceFilter = {}): Promise<number> {
    const { clause, params } = this.where(filter);
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM provenance_records ${clause}`).get(...params) as { n: number };
    return Number(row.n);
  }

  /**
   * Close the database handle, flushing the WAL.
   */
  async close(): Promise<void> {
    this.db.close();
  }
}
