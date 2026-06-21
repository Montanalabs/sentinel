/**
 * Process entrypoint for the Sentinel sidecar.
 *
 * Loads environment + config, pulls in any user {@link loadExtensions}, wires the sidecar via
 * {@link buildSentinel}, runs a config {@link preflight}, and starts the HTTP listener. With
 * `--watch` (or `SENTINEL_WATCH=1`) — which `sentinel init` enables for its auto-start — it also
 * watches `.env` / `sentinel.config.*` and **hot-restarts in-process** on save, reusing one signer so
 * the provenance chain stays continuous. Watch is a dev/onboarding affordance: production runs without
 * it (config is immutable per process; changes take effect on restart). On a startup failure it logs
 * and, in non-watch mode, exits non-zero.
 */
import { watchFile, existsSync, readFileSync } from 'node:fs';
import { loadConfig, parseDotenv } from '../config.js';
import { buildSentinel, type BootstrapOverrides, type BuiltSentinel } from './bootstrap.js';
import { loadExtensions } from './extensions.js';
import { StaticLedgerConnector } from '../connectors/static-ledger.js';
import type { Signer } from '../provenance/signing.js';
import { preflight, PreflightSeverity } from './preflight.js';
import { accent, bold, dim, success, warn, danger } from '../term/colors.js';

const ENV_PATH = '.env';
const WATCH_FILES = [ENV_PATH, 'sentinel.config.mjs', 'sentinel.config.js'];

// The real environment, snapshotted before any .env is applied — so a reload re-applies the latest
// .env value (even a changed one) while a genuinely-exported variable always wins.
const ORIGINAL_ENV: NodeJS.ProcessEnv = { ...process.env };

/** Apply `.env` over the original environment: a real exported var wins, else the latest `.env` value. */
function applyEnv(): void {
  if (!existsSync(ENV_PATH)) return;
  for (const [k, v] of Object.entries(parseDotenv(readFileSync(ENV_PATH, 'utf8')))) {
    const real = ORIGINAL_ENV[k];
    process.env[k] = real !== undefined && real !== '' ? real : v;
  }
}

/** Build the connector/pack overrides, falling back to a labelled demo ledger so the gate blocks out of the box. */
async function buildOverrides(): Promise<BootstrapOverrides> {
  const ext = await loadExtensions(process.cwd(), process.env);
  const ledger =
    ext.ledger ??
    new StaticLedgerConnector({
      balances: { acct_treasury: 5_000_000, acct_ops: 250_000, acct_1: 100_000 },
      sanctioned: ['acct_ofac_1', 'acct_evil'],
    });
  return { ledger, ...(ext.clinical ? { clinical: ext.clinical } : {}), ...(ext.packs ? { extraPacks: ext.packs } : {}) };
}

function printPreflight(config: ReturnType<typeof loadConfig>): void {
  for (const issue of preflight(config)) {
    const color = issue.severity === PreflightSeverity.Error ? danger : warn;
    // Color-only severity (no decorative glyph): an orange/red message with a dim, actionable hint.
    console.warn(`${color(issue.message)}\n  ${dim(`↳ ${issue.hint}`)}`);
  }
}

let current: BuiltSentinel | undefined;
let signer: Signer | undefined; // reused across reloads to keep one signing identity

/** Build, listen, and report once. Returns whether the sidecar is now serving. */
async function boot(): Promise<boolean> {
  applyEnv();
  const config = loadConfig();
  if (current) {
    await current.close().catch(() => undefined);
    current = undefined;
  }
  try {
    const overrides = await buildOverrides();
    const built = await buildSentinel(config, { ...overrides, ...(signer ? { signer } : {}) });
    signer = built.signer; // capture so the next reload reuses this identity
    // Default to loopback: the /v1/* API is unauthenticated, so it must not be exposed beyond a
    // trusted boundary unless the operator opts in with SENTINEL_HOST=0.0.0.0.
    const host = config.host ?? '127.0.0.1';
    await built.app.listen({ port: config.sidecarPort, host });
    current = built;
    const extra = overrides.extraPacks?.length ? `, +${overrides.extraPacks.length} custom pack(s)` : '';
    const shown = host === '0.0.0.0' ? `0.0.0.0:${config.sidecarPort}` : `http://localhost:${config.sidecarPort}`;
    console.log(
      `${success('✓')} ${bold('Sentinel')} sidecar listening on ${accent(shown)} ` +
        dim(`(signer ${built.signer.keyId}, provider ${config.secondOpinionProvider}${extra})`),
    );
    printPreflight(config);
    return true;
  } catch (err) {
    // pg's connection-refused error often has an empty .message; fall back to its code so the
    // operator gets something actionable instead of a bare "failed to start:".
    const e = err as { message?: string; code?: string };
    const detail = e.message || e.code || String(err);
    console.error(`${danger('Sentinel sidecar failed to start:')} ${detail}`);
    if ((config.databaseUrl ?? '').startsWith('postgres')) {
      console.error(`  ${dim('↳ is Postgres running and reachable at SENTINEL_DATABASE_URL? for local dev: docker compose up -d postgres')}`);
    }
    return false;
  }
}

async function main(): Promise<void> {
  const watch = process.argv.includes('--watch') || /^(1|true|yes|on)$/i.test(process.env['SENTINEL_WATCH'] ?? '');
  const ok = await boot();

  if (!watch) {
    if (!ok) process.exit(1); // prod: a misconfigured boot fails fast
    return;
  }

  // Watch mode: reload on a debounced .env / config change, and keep running even if a build failed
  // (so the operator can fix the config and have it picked up on save).
  const files = WATCH_FILES.filter(existsSync);
  console.log(dim(`↻ watching ${files.join(', ') || ENV_PATH} — edit and save to reload (changing the signing seed still needs a restart)`));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(dim('↻ config changed — reloading…'));
      void boot();
    }, 250);
  };
  for (const f of files) watchFile(f, { interval: 800 }, schedule);
}

// Graceful shutdown: on SIGTERM/SIGINT (k8s/ECS pod termination, Ctrl+C) stop accepting connections,
// let Fastify drain in-flight /v1 requests (which include the serialized provenance append), close
// the store, then exit — so no in-flight decision is dropped and the chain critical section is not
// cut mid-append. A hard-exit timer bounds the drain so a stuck connection can't hang termination.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(dim(`\n↓ ${signal} — draining in-flight requests and shutting down…`));
  const hard = setTimeout(() => process.exit(1), 10_000);
  hard.unref();
  try {
    if (current) await current.close();
    console.log(dim('✓ drained; bye'));
    process.exit(0);
  } catch (err) {
    console.error(danger('shutdown error:'), (err as Error).message);
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err) => {
  console.error(danger('Sentinel sidecar failed to start:'), err);
  process.exit(1);
});
