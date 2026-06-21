/**
 * The CLI version, resolved from the single source of truth — never hardcoded.
 *
 * Resolution order: a build-time-injected value first (the standalone binary, where `package.json`
 * is not on disk — the SEA build defines `process.env.SENTINEL_BUILD_VERSION` via esbuild), otherwise
 * the manifest read at runtime (dev via `tsx`, and the published npm package, both of which have
 * `package.json` two directories up). So the displayed version always matches the release.
 */

import { createRequire } from 'node:module';

function resolveVersion(): string {
  const injected = process.env.SENTINEL_BUILD_VERSION; // set by the binary build (esbuild define)
  if (injected) return injected;
  try {
    const pkg = createRequire(import.meta.url)('../../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Resolved CLI version, e.g. `0.2.3`. */
export const VERSION = resolveVersion();
