/**
 * Shared, memoized loader for Node's built-in `node:sqlite` driver.
 *
 * Both the provenance {@link SqliteStore} and the SQLite {@link NonceStore} defer-load the driver
 * through here so the one-time "SQLite is experimental" warning is suppressed exactly once and the
 * global `process.emitWarning` swap never races across concurrent openers.
 */

let sqliteModule: Promise<typeof import('node:sqlite')> | undefined;

/**
 * Dynamically import `node:sqlite`, suppressing its one-time experimental warning.
 *
 * Loading is deferred (and memoized) so processes that never use a SQLite backend don't pull in the
 * module or emit its notice, and the `process.emitWarning` patch/restore happens a single time.
 *
 * @returns The `node:sqlite` module namespace.
 * @throws {Error} Propagated from the dynamic import if `node:sqlite` is unavailable (older Node).
 */
export async function loadSqlite(): Promise<typeof import('node:sqlite')> {
  if (sqliteModule) return sqliteModule;
  sqliteModule = (async () => {
    const orig = process.emitWarning;
    process.emitWarning = function (warning: string | Error, ...args: unknown[]) {
      const msg = typeof warning === 'string' ? warning : (warning?.message ?? '');
      if (msg.includes('SQLite is an experimental')) return;
      return (orig as (w: string | Error, ...a: unknown[]) => void).call(process, warning, ...args);
    } as typeof process.emitWarning;
    try {
      return await import('node:sqlite');
    } finally {
      process.emitWarning = orig;
    }
  })();
  return sqliteModule;
}
