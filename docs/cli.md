# CLI reference

The `sentinel` CLI runs and scaffolds the gate. It ships as a **standalone binary** (no Node.js
required) and is also runnable from source (`npm run cli -- <command>` or `tsx src/cli/main.ts`).

```
sentinel <command> [options]

Commands:
  init [dir] [--yes]   Interactive setup wizard + scaffold a project
  start                Run the sidecar from the current environment (.env)
  keygen               Print a base64 Ed25519 signing seed for SENTINEL_SIGNING_SEED
  verify [url]         Verify the provenance chain of a running sidecar
  version | help
```

## Install

See the [README](../README.md) for the one-line installers. In short:

```bash
# macOS / Linux
curl -fsSL https://montanalabs.ai/sentinel/install.sh | sh
# Windows (PowerShell)
irm https://montanalabs.ai/sentinel/install.ps1 | iex
```

Or run the official Docker image (entrypoint is `sentinel start`):

```bash
docker run -p 4000:4000 --env-file .env ghcr.io/montanalabs/sentinel:latest
```

## `sentinel init [dir] [--yes]`

Interactive wizard that scaffolds a ready-to-run project. It asks for:

- **Project name** and **port** (default `4000`)
- **Second-opinion provider** — `mock` (offline, no key) · `anthropic` · `openai`, plus the model id
- **Provenance store** — `memory` · `sqlite` · `postgres` (default), with a connection URL
- **Built-in packs** — `fintech`, `healthcare` (comma-separated)
- Whether to include a **custom-pack template**
- Whether to **generate a signing seed** now

It writes `.env`, `.gitignore`, `docker-compose.yml`, a `README.md`, and `sentinel.config.mjs`, then
offers to bring up Postgres (if selected) and start the sidecar with `--watch`.

```bash
sentinel init my-gate          # interactive
sentinel init my-gate --yes    # non-interactive (defaults), for CI/scripts
```

**Postgres bring-up (since v1.0.1):** when you accept the bundled Postgres, the wizard publishes it on
host port **5433** (→ container 5432) so it can't collide with a Postgres already on 5432, and starts
it behind a branded spinner. If you supply your **own** `SENTINEL_DATABASE_URL`, the wizard skips
Docker entirely and connects straight to your database. With no Docker available, it points you at the
zero-infra SQLite store or your own Postgres rather than dead-ending.

## `sentinel start`

Boots the sidecar from the current environment / `.env`. This is the Docker image's entrypoint.

```bash
sentinel start
sentinel start --watch      # hot-reload .env and sentinel.config.* on save
```

- Reads all `SENTINEL_*` variables (see the [configuration table](./self-hosting.md#configuration-environment)).
- Loads an optional **`sentinel.config.mjs`** from the working directory to wire custom
  connectors/packs without forking (`SENTINEL_CONFIG=path` to point elsewhere).
- Binds **loopback** (`127.0.0.1`) by default; set `SENTINEL_HOST=0.0.0.0` to listen on all interfaces
  (only behind a trusted gateway).
- Handles `SIGTERM`/`SIGINT` gracefully — drains in-flight requests before exit, so rolling restarts
  don't drop decisions.
- `--watch` re-applies `.env` and config changes live (changing `SENTINEL_SIGNING_SEED` still needs a
  full restart, since it's the signing identity).

## `sentinel keygen`

Prints a fresh base64 Ed25519 seed. Put it in `.env` as `SENTINEL_SIGNING_SEED` to give the sidecar a
**stable signing identity** across restarts (otherwise an ephemeral key is generated at boot and your
records can't be verified against a known key after a restart).

```bash
echo "SENTINEL_SIGNING_SEED=$(sentinel keygen)" >> .env
```

Treat the seed as a secret — it is the identity that signs your audit trail.

## `sentinel verify [url]`

Hits a running sidecar's `/v1/verify` and exits **0** when the provenance chain is intact (`ok:true`),
**1** otherwise — so it's usable as a CI / health gate.

```bash
sentinel verify                         # default http://localhost:4000
sentinel verify http://gate.internal:4000
SENTINEL_URL=http://gate:4000 sentinel verify
```

## `sentinel version` / `sentinel help`

`version` prints the build version (resolved from the package / `SENTINEL_BUILD_VERSION`). `help`
prints the usage banner.

## From source (no install)

```bash
npm run sidecar          # = tsx src/sidecar/main.ts  (run the gate)
npm run cli -- init      # = tsx src/cli/main.ts init
npm run cli -- keygen
```
