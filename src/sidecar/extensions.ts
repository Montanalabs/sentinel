import { existsSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LedgerConnector, ClinicalConnector } from '../connectors/types.js';
import type { PolicyPack } from '../policy-packs/index.js';

/**
 * Optional user-supplied extension loading for the sidecar. Lets the stock image
 * or CLI run a customized gate — real {@link LedgerConnector}/{@link ClinicalConnector}
 * implementations plus extra {@link PolicyPack}s — by dropping in a
 * `sentinel.config.{mjs,js}` file, without forking the engine. Consumed by the
 * sidecar entrypoint before {@link buildSentinel}.
 */

const CANDIDATES = ['sentinel.config.mjs', 'sentinel.config.js'];

/**
 * Resolve the path to the optional server extension file.
 *
 * Resolution order: the `SENTINEL_CONFIG` env var (relative paths resolved
 * against `cwd`) if it points at an existing file, otherwise `sentinel.config.mjs`
 * then `sentinel.config.js` in `cwd`.
 *
 * @param cwd - Directory to resolve relative paths and candidate filenames against.
 * @param env - Process environment consulted for the `SENTINEL_CONFIG` override.
 * @param exists - File-existence predicate; injectable so tests need no real FS.
 * @returns The absolute config path, or `null` when no extension file is found.
 */
export function resolveConfigPath(
  cwd: string,
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean = existsSync,
): string | null {
  if (env.SENTINEL_CONFIG) {
    const p = isAbsolute(env.SENTINEL_CONFIG) ? env.SENTINEL_CONFIG : resolve(cwd, env.SENTINEL_CONFIG);
    return exists(p) ? p : null;
  }
  for (const c of CANDIDATES) {
    const p = join(cwd, c);
    if (exists(p)) return p;
  }
  return null;
}

/**
 * User-supplied sidecar customizations loaded from a `sentinel.config.{mjs,js}`:
 * real connectors and additional {@link PolicyPack}s. Any field may be absent.
 */
export interface ServerExtensions {
  readonly ledger?: LedgerConnector;
  readonly clinical?: ClinicalConnector;
  readonly packs?: readonly PolicyPack[];
}

/**
 * Load connectors and custom packs from the resolved `sentinel.config.{mjs,js}`.
 *
 * Dynamically imports the config (honoring either a `default` export or top-level
 * named `ledger` / `clinical` / `packs` exports) so the stock image or CLI can run
 * a customized gate without forking the engine.
 *
 * @param cwd - Directory used by {@link resolveConfigPath} to locate the config.
 * @param env - Process environment consulted for the `SENTINEL_CONFIG` override.
 * @returns The discovered {@link ServerExtensions}, or `{}` when no config file
 *   exists.
 * @throws If a config file is found but its module fails to import or evaluate.
 * @remarks Importing executes arbitrary code from the resolved file — by design, but the path is
 *   logged so an operator can see exactly what code the sidecar loaded at boot.
 */
export async function loadExtensions(cwd: string, env: NodeJS.ProcessEnv): Promise<ServerExtensions> {
  const path = resolveConfigPath(cwd, env);
  if (!path) return {};
  // This executes code from `path`. Surface it loudly so loading an unexpected file is visible.
  console.warn(`[sentinel] loading and EXECUTING extension config: ${path}`);
  const mod = (await import(pathToFileURL(path).href)) as { default?: ServerExtensions } & ServerExtensions;
  const cfg = mod.default ?? mod;
  return {
    ...(cfg.ledger ? { ledger: cfg.ledger } : {}),
    ...(cfg.clinical ? { clinical: cfg.clinical } : {}),
    ...(cfg.packs ? { packs: cfg.packs } : {}),
  };
}
