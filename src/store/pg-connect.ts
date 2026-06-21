/**
 * Shared Postgres connection helper with bounded connect retry.
 *
 * At boot a sidecar can start before its database is reachable — k8s pod ordering, a `docker compose
 * up` race (the case `sentinel init` hits), or RDS warmup. Rather than dead-end startup on the first
 * `ECONNREFUSED`, retry the schema-ensuring query with backoff for a few seconds. After the bound is
 * exhausted the original error propagates, so a genuinely-misconfigured URL still fails (loudly).
 */

import pg from 'pg';

/**
 * Create a pool and run `ddl`, retrying transient connection failures with backoff.
 *
 * @param url - `postgres://` connection string.
 * @param ddl - Schema statement(s) run once the connection succeeds (also the connectivity probe).
 * @param opts - `attempts` caps the tries (default 10, ≈ up to ~20s of backoff).
 * @returns A ready, schema-ensured pool.
 */
export async function pgPool(url: string, ddl: string, opts: { attempts?: number } = {}): Promise<pg.Pool> {
  const attempts = opts.attempts ?? 10;
  const pool = new pg.Pool({ connectionString: url });
  for (let i = 0; ; i++) {
    try {
      await pool.query(ddl);
      return pool;
    } catch (err) {
      if (i >= attempts - 1) {
        await pool.end().catch(() => undefined);
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(500 * (i + 1), 3000)));
    }
  }
}
