/**
 * URL-keyed factory for the provenance store subsystem.
 *
 * Resolves a deployment's store URL to the matching {@link ProvenanceStore} backend so the URL is
 * the single configuration point and callers never construct a driver directly. The barrel
 * re-exports {@link openStore}; import it from the module barrel rather than this file.
 */

import type { ProvenanceStore } from './types.js';
import { InMemoryStore } from './memory.js';
import { PostgresStore } from './postgres.js';
import { SqliteStore } from './sqlite.js';

/**
 * Resolve a {@link ProvenanceStore} from a store URL.
 *
 * The URL scheme selects the backend:
 *   - falsy / `memory`         -> {@link InMemoryStore} (dev/test)
 *   - `sqlite:<path>` / `sqlite::memory:` -> {@link SqliteStore} (durable, no server)
 *   - `postgres://...`         -> {@link PostgresStore} (durable, multi-writer/HA)
 *
 * @param url - The store connection URL; falsy selects the in-memory backend.
 *   A bare `sqlite:` (empty path) maps to an in-process `:memory:` database.
 * @returns A ready-to-use store; durable backends are already connected and
 *   their schema is ensured.
 * @throws {Error} If the URL scheme is not `memory`, `sqlite:`, or `postgres(ql)://`.
 * @throws {Error} Propagated from {@link SqliteStore.open} or
 *   {@link PostgresStore.connect} if the backend fails to initialise (e.g.
 *   connection refused, schema DDL error).
 * @example
 * const store = await openStore(process.env.STORE_URL);
 * await store.append(record);
 */
export async function openStore(url?: string): Promise<ProvenanceStore> {
  if (!url || url === 'memory') return new InMemoryStore();
  if (url.startsWith('sqlite:')) {
    // SqliteStore loads node:sqlite lazily inside open(), so importing it is cheap.
    return SqliteStore.open(url.slice('sqlite:'.length) || ':memory:');
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return PostgresStore.connect(url);
  }
  // Echo only the scheme, never the full URL — it may carry DB credentials that would leak to logs.
  const scheme = url.includes('://') ? url.slice(0, url.indexOf('://') + 3) : url.split(':')[0];
  throw new Error(`unsupported store URL scheme: ${scheme}`);
}
