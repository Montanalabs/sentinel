/**
 * Project scaffolding for the `sentinel init` CLI command.
 *
 * Turns the answers collected by the wizard (see {@link ScaffoldOptions}) into the
 * full set of source and config files for a self-hosted Sentinel gate — `.env`,
 * `src/server.ts`, Docker assets, `package.json`, and an optional custom policy
 * pack. The generated `server.ts` wires the engine, store, signer, second-opinion
 * provider, and the selected built-in {@link PackId} packs. This module only emits
 * file contents as strings; the CLI ({@link file://./main.ts}) is responsible for
 * writing them to disk.
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

const DEFAULT_DB = 'postgres://sentinel:sentinel@localhost:5433/sentinel';

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

# base64 Ed25519 seed for a STABLE signing identity (npx sentinel keygen)
SENTINEL_SIGNING_SEED=${r.signingSeed}

# Optional
SENTINEL_SLOW_BUDGET_MS=
SENTINEL_ESCALATION_WEBHOOK_URL=
SENTINEL_RATE_LIMIT_BURST=
SENTINEL_RATE_LIMIT_RPS=
SENTINEL_MAX_CONCURRENT=
`;
}

function serverFile(r: Resolved): string {
  const usesFintech = r.packs.includes(PackId.Fintech);
  const usesHealth = r.packs.includes(PackId.Healthcare);

  const named = [
    'loadEnvFile',
    'loadConfig',
    'PolicyRegistry',
    'Engine',
    'RecordBuilder',
    'Signer',
    'openStore',
    'buildServer',
    'EscalationManager',
    'makeProvider',
    ...(usesFintech ? ['fintechPaymentsPack', 'StaticLedgerConnector'] : []),
    ...(usesHealth ? ['healthcareRecordsPack', 'StaticClinicalConnector'] : []),
  ];

  const deps: string[] = ['provider'];
  const wires: string[] = [];
  if (usesFintech) {
    wires.push("const ledger = new StaticLedgerConnector({ balances: { acct_ops: 1_000_000 }, sanctioned: [] });");
    deps.push('ledger');
  }
  if (usesHealth) {
    wires.push("const clinical = new StaticClinicalConnector({ patients: ['p1'] });");
    deps.push('clinical');
  }

  const registers = [
    ...(usesFintech ? ['  .register(fintechPaymentsPack({ highValueThreshold: 25_000 }))'] : []),
    ...(usesHealth ? ['  .register(healthcareRecordsPack())'] : []),
    ...(r.customPack ? ['  .register(myPack())'] : []),
  ];

  return `import {
  ${named.join(',\n  ')},
} from 'sentinel';
${r.customPack ? "import { myPack } from './my-pack.js';\n" : ''}
loadEnvFile();
const config = loadConfig();

const store = await openStore(config.databaseUrl);
const signer = config.signingSeed ? Signer.fromSeed(Buffer.from(config.signingSeed, 'base64')) : Signer.generate();
const builder = new RecordBuilder(signer);
const tail = await store.tail();
if (tail) builder.resume(tail.contentHash, tail.seq + 1);

const provider = makeProvider(config.secondOpinionProvider, {
  ...(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {}),
  ...(config.secondOpinionModel ? { model: config.secondOpinionModel } : {}),
});
${wires.length ? '\n' + wires.join('\n') + '\n' : ''}
const registry = new PolicyRegistry({ ${deps.join(', ')} })
${registers.join('\n')};

const engine = new Engine({ resolve: (id) => registry.resolve(id), builder, store });
const app = buildServer({ engine, store, escalations: new EscalationManager(), builder });

await app.listen({ port: config.sidecarPort, host: '0.0.0.0' });
console.log('Sentinel listening on :' + config.sidecarPort + ' (signer ' + signer.keyId + ')');
`;
}

const MY_PACK_TS = `import { SchemaCheck, PolicyCheck, type Check } from 'sentinel';
import type { PackDeps, PolicyPack } from 'sentinel';

// A starter custom pack. Compose checks; see docs/policy-packs.md for the full reference.
export function myPack(): PolicyPack {
  return {
    id: 'my.actions',
    build(_deps: PackDeps): Check[] {
      return [
        new SchemaCheck({
          email: { type: 'object', required: ['to', 'subject'], properties: { to: { type: 'string' }, subject: { type: 'string' } } },
        }),
        new PolicyCheck({
          id: 'my.actions',
          rules: [
            { id: 'external_email', when: { not: { field: 'action.payload.to', op: 'contains', value: '@acme.com' } },
              effect: 'require_approval', approvers: ['comms'], reason: 'external recipient' },
          ],
        }),
      ];
    },
  };
}
`;

function composeFile(r: Resolved): string {
  if (r.store === StoreKind.Postgres) {
    return `services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: sentinel
      POSTGRES_PASSWORD: sentinel
      POSTGRES_DB: sentinel
    ports: ["5433:5432"]

  sentinel:
    build: .
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
    build: .
    env_file: .env
    ports: ["${r.port}:${r.port}"]
    volumes:
      - sentinel-data:/app/data    # SQLite store: set SENTINEL_DATABASE_URL=sqlite:/app/data/sentinel.db

volumes:
  sentinel-data:
`;
}

const DOCKERFILE = `FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 4000
CMD ["npx", "tsx", "src/server.ts"]
`;

const GITIGNORE = 'node_modules/\n.env.local\n*.log\n*.db\n*.db-wal\n*.db-shm\ndata/\n';

function readme(r: Resolved): string {
  return `# ${r.name}

A self-hosted [Sentinel](https://github.com/montanalabs/sentinel) action-gate.
Packs: ${r.packs.join(', ')}${r.customPack ? ' + my.actions (custom)' : ''} · provider: ${r.provider} · store: ${r.store}.

> **Prerequisite:** this project depends on the \`sentinel\` npm package. If \`npm install\` cannot
> find it, the package is not published to your registry yet — install it from the Sentinel repo
> (\`npm install /path/to/sentinel\`) or your private registry before running.

## Run
\`\`\`bash
npm install
npx sentinel keygen   # paste into SENTINEL_SIGNING_SEED in .env (else an ephemeral key is used each boot)
npm start             # sidecar on :${r.port}  ·  console at http://localhost:${r.port}/dashboard
\`\`\`
Or with Docker: \`docker compose up\`.

## Customize
- \`src/my-pack.ts\` — your policy pack.
- \`src/server.ts\` — wire your real connectors and register packs.
`;
}

function packageJson(r: Resolved): string {
  return (
    JSON.stringify(
      {
        name: r.name,
        private: true,
        type: 'module',
        scripts: { start: 'tsx src/server.ts' },
        dependencies: { sentinel: '^0.1.0', tsx: '^4.19.2' },
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * Render the complete file set for a self-hosted Sentinel project.
 *
 * Resolves {@link ScaffoldOptions} against defaults, then emits the project's
 * `.env`, `.gitignore`, Docker assets, `package.json`, `README.md`, and
 * `src/server.ts` (pre-wired for the chosen {@link ProviderKind}, {@link StoreKind},
 * and {@link PackId} packs). A `src/my-pack.ts` starter is included only when a
 * custom pack was requested. The result is a map of project-relative path to file
 * contents; callers decide how to write it (the CLI skips files that already
 * exist on disk).
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
    'Dockerfile': DOCKERFILE,
    'package.json': packageJson(r),
    'README.md': readme(r),
    'src/server.ts': serverFile(r),
  };
  if (r.customPack) files['src/my-pack.ts'] = MY_PACK_TS;
  return files;
}
