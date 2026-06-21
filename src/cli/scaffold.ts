/**
 * Project scaffolding for the `sentinel init` CLI command.
 *
 * Turns the answers collected by the wizard (see {@link ScaffoldOptions}) into the config files for
 * a self-hosted Sentinel gate that runs on the `sentinel` binary (or the official Docker image) —
 * `.env`, `.gitignore`, a `docker-compose.yml` using the published image, a `README.md`, and an
 * optional commented `sentinel.config.mjs` customization template. It emits **no** npm project or
 * source to compile: the binary already contains the engine and built-in {@link PackId} packs.
 * This module only returns file contents as strings; the CLI ({@link file://./main.ts}) writes them.
 */

/** Cross-model second-opinion provider a scaffolded gate is wired for. */
export enum ProviderKind {
  Mock = 'mock',
  Anthropic = 'anthropic',
  OpenAI = 'openai',
}

/** Provenance store backend a scaffolded gate is wired for. */
export enum StoreKind {
  Memory = 'memory',
  Sqlite = 'sqlite',
  Postgres = 'postgres',
}

/** Built-in policy pack a scaffolded gate can enable. */
export enum PackId {
  Fintech = 'fintech',
  Healthcare = 'healthcare',
}

/**
 * Operator-supplied choices that shape a scaffolded gate.
 *
 * Every field is optional; {@link scaffoldFiles} fills any gap with a sensible
 * default, so an empty object yields a runnable starter project. Populated by the
 * `sentinel init` wizard (see {@link Ask}) or passed directly for non-interactive
 * scaffolding.
 *
 * @remarks `port` is the TCP port the sidecar listens on (defaults to 4000).
 *   `databaseUrl` is only meaningful for {@link StoreKind.Sqlite} and
 *   {@link StoreKind.Postgres}; for {@link StoreKind.Memory} it is ignored.
 *   `signingSeed` is a base64 Ed25519 seed (see {@link generateSigningSeed}); an
 *   empty string leaves `SENTINEL_SIGNING_SEED` blank for the operator to fill in.
 */
export interface ScaffoldOptions {
  readonly name?: string;
  readonly port?: number;
  readonly provider?: ProviderKind;
  readonly model?: string;
  readonly store?: StoreKind;
  readonly databaseUrl?: string;
  readonly packs?: readonly PackId[];
  readonly customPack?: boolean;
  readonly signingSeed?: string;
}

interface Resolved {
  readonly name: string;
  readonly port: number;
  readonly provider: ProviderKind;
  readonly model: string;
  readonly store: StoreKind;
  readonly databaseUrl: string;
  readonly packs: readonly PackId[];
  readonly customPack: boolean;
  readonly signingSeed: string;
}

const DEFAULT_DB = 'postgres://sentinel:sentinel@localhost:5432/sentinel';

/**
 * Strip newlines/control chars from a free-text value before it is written into generated config
 * (`.env`, etc.), so a crafted `name`/`model`/`databaseUrl`/`signingSeed` cannot inject extra
 * lines or break out of its field. `scaffoldFiles` is a public API, so inputs are untrusted.
 */
function oneLine(value: string): string {
  return value.replace(new RegExp("[\\x00-\\x1F\\x7F]", "g"), "").trim();
}

function resolve(o: ScaffoldOptions): Resolved {
  const provider = o.provider ?? ProviderKind.Mock;
  const port = o.port;
  return {
    name: oneLine(o.name ?? 'my-sentinel') || 'my-sentinel',
    // Public API: clamp a bad port to the default so generated docker-compose/README stay valid.
    port: port !== undefined && Number.isInteger(port) && port > 0 && port <= 65535 ? port : 4000,
    provider,
    model: oneLine(o.model ?? (provider === ProviderKind.OpenAI ? 'gpt-5.5' : 'claude-sonnet-4-6')),
    store: o.store ?? StoreKind.Memory,
    databaseUrl: oneLine(o.databaseUrl ?? (o.store === StoreKind.Sqlite ? 'sqlite:./sentinel.db' : DEFAULT_DB)),
    packs: o.packs && o.packs.length ? o.packs : [PackId.Fintech],
    customPack: o.customPack ?? true,
    signingSeed: oneLine(o.signingSeed ?? ''),
  };
}

function envFile(r: Resolved): string {
  return `# Sentinel sidecar configuration (copy real secrets here; keep .env out of git)
SENTINEL_SIDECAR_PORT=${r.port}

# Provenance store
SENTINEL_DATABASE_URL=${r.store === StoreKind.Memory ? 'memory' : r.databaseUrl}

# Cross-model second opinion: mock | anthropic | openai
SENTINEL_SECOND_OPINION_PROVIDER=${r.provider}
SENTINEL_SECOND_OPINION_MODEL=${r.model}
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# base64 Ed25519 seed for a STABLE signing identity (run: sentinel keygen)
SENTINEL_SIGNING_SEED=${r.signingSeed}

# Optional
SENTINEL_SLOW_BUDGET_MS=
SENTINEL_ESCALATION_WEBHOOK_URL=
SENTINEL_RATE_LIMIT_BURST=
SENTINEL_RATE_LIMIT_RPS=
SENTINEL_MAX_CONCURRENT=
`;
}

function composeFile(r: Resolved): string {
  // Pull the official prebuilt image — no Dockerfile/npm build in the user's project.
  if (r.store === StoreKind.Postgres) {
    return `services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: sentinel
      POSTGRES_PASSWORD: sentinel
      POSTGRES_DB: sentinel
    ports: ["5432:5432"]

  sentinel:
    image: ghcr.io/montanalabs/sentinel:latest
    env_file: .env
    environment:
      SENTINEL_DATABASE_URL: postgres://sentinel:sentinel@postgres:5432/sentinel
    ports: ["${r.port}:${r.port}"]
    depends_on: [postgres]
`;
  }
  // memory / sqlite: just the sidecar. A volume persists the SQLite file across restarts.
  return `services:
  sentinel:
    image: ghcr.io/montanalabs/sentinel:latest
    env_file: .env
    ports: ["${r.port}:${r.port}"]
    volumes:
      - sentinel-data:/app/data    # SQLite store: set SENTINEL_DATABASE_URL=sqlite:/app/data/sentinel.db

volumes:
  sentinel-data:
`;
}

const GITIGNORE = '.env\n.env.local\n*.log\n*.db\n*.db-wal\n*.db-shm\ndata/\n';

/**
 * Optional customization file, auto-loaded by `sentinel start` (and the Docker image) if present.
 * Building custom connectors/packs needs the `@montanalabs/sentinel` library — so this ships as a
 * commented template that is a no-op until the user opts in. `export {}` keeps it a valid, empty
 * ES module so loading never fails.
 */
const SENTINEL_CONFIG = `// Optional Sentinel customization — loaded automatically by \`sentinel start\`.
//
// Export \`ledger\`, \`clinical\`, and/or \`packs\` to plug your own ground-truth connectors and
// policy packs into the gate. This requires the \`@montanalabs/sentinel\` library (npm); install it,
// then uncomment and adapt the example below.
//
// import { StaticLedgerConnector } from '@montanalabs/sentinel';
//
// export const ledger = new StaticLedgerConnector({
//   balances: { acct_ops: 1_000_000 },
//   sanctioned: [],
// });
//
// export const packs = [ /* your custom PolicyPack(s) */ ];

export {};
`;

function readme(r: Resolved): string {
  return `# ${r.name}

A self-hosted [Sentinel](https://github.com/montanalabs/sentinel) action-gate.
Packs: ${r.packs.join(', ')}${r.customPack ? ' + sentinel.config.mjs (custom)' : ''} · provider: ${r.provider} · store: ${r.store}.

## Run

Install the \`sentinel\` CLI (see https://github.com/montanalabs/sentinel#install-the-cli), then from this folder:

\`\`\`bash
sentinel keygen        # paste the seed into SENTINEL_SIGNING_SEED in .env (else an ephemeral key each boot)
sentinel start         # sidecar on :${r.port}  ·  console at http://localhost:${r.port}/dashboard
\`\`\`

Or with Docker (pulls the official image — no CLI needed):

\`\`\`bash
docker compose up
\`\`\`

## Configure
- \`.env\` — store, second-opinion provider, API keys, signing seed.${
    r.customPack
      ? `\n- \`sentinel.config.mjs\` — your custom connectors / policy packs (needs the \`@montanalabs/sentinel\` library).`
      : ''
  }
`;
}

/**
 * Render the file set for a self-hosted Sentinel project that runs on the `sentinel` binary (or the
 * official Docker image) — no npm install, no build step.
 *
 * Resolves {@link ScaffoldOptions} against defaults, then emits `.env`, `.gitignore`,
 * `docker-compose.yml` (using the published image), and a `README.md`. A commented
 * `sentinel.config.mjs` customization template is included only when a custom pack was requested.
 * The result is a map of project-relative path to file contents; callers decide how to write it
 * (the CLI skips files that already exist on disk).
 *
 * @param opts - Operator choices; an empty object produces a runnable default gate.
 * @returns A map from project-relative file path to that file's textual contents.
 */
export function scaffoldFiles(opts: ScaffoldOptions = {}): Record<string, string> {
  const r = resolve(opts);
  const files: Record<string, string> = {
    '.env': envFile(r),
    '.gitignore': GITIGNORE,
    'docker-compose.yml': composeFile(r),
    'README.md': readme(r),
  };
  if (r.customPack) files['sentinel.config.mjs'] = SENTINEL_CONFIG;
  return files;
}
