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

## `sentinel init`
Interactive wizard that scaffolds a ready-to-run project.

**Usage:**
```bash
sentinel init [dir] [--yes]
```
**Flags:**
- `--yes`, `-y` — non-interactive; accept all defaults (for CI / scripts).

**Prompts:** project name & port (default `4000`); second-opinion provider (`mock` · `anthropic` · `openai`) + model; provenance store (`memory` · `sqlite` · `postgres`, default) + connection URL; built-in packs (`fintech`, `healthcare`); custom-pack template; signing seed.

It writes `.env`, `.gitignore`, `docker-compose.yml`, `README.md`, and `sentinel.config.mjs`, then offers to bring up Postgres and start the sidecar with `--watch`.

> **Postgres bring-up:** with the bundled Postgres the wizard publishes host port **5433** (→ container 5432) so it can't collide with a Postgres already on 5432. Supply your own `SENTINEL_DATABASE_URL` and it skips Docker entirely; with no Docker it points you at the zero-infra SQLite store rather than dead-ending.

## `sentinel start`
Boot the sidecar from the current environment / `.env`. This is the Docker image's entrypoint.

**Usage:**
```bash
sentinel start [--watch]
```
**Flags:**
- `--watch` — hot-reload `.env` and `sentinel.config.*` on save. (Changing `SENTINEL_SIGNING_SEED` still needs a full restart — it's the signing identity.)

**Notes:**
- Reads all `SENTINEL_*` variables (see the [configuration table](./self-hosting.md#configuration-environment)).
- Loads an optional `sentinel.config.mjs` from the working directory (`SENTINEL_CONFIG=path` to point elsewhere) to wire custom connectors/packs without forking.
- Binds **loopback** (`127.0.0.1`) by default; set `SENTINEL_HOST=0.0.0.0` to listen on all interfaces, only behind a trusted gateway.
- Drains in-flight requests on `SIGTERM`/`SIGINT`, so rolling restarts don't drop decisions.

## `sentinel keygen`
Print a fresh base64 Ed25519 seed for `SENTINEL_SIGNING_SEED` — the sidecar's **stable signing identity** across restarts. Without it, an ephemeral key is generated at boot and records can't be verified against a known key afterward. Treat it as a secret.

**Usage:**
```bash
sentinel keygen
```
**Example:**
```bash
echo "SENTINEL_SIGNING_SEED=$(sentinel keygen)" >> .env
```

## `sentinel verify`
Check a running sidecar's provenance chain via `/v1/verify`. Exits **0** when intact (`ok:true`), **1** otherwise — usable as a CI / health gate.

**Usage:**
```bash
sentinel verify [url]   # default http://localhost:4000, or $SENTINEL_URL
```
**Example:**
```bash
sentinel verify http://gate.internal:4000
SENTINEL_URL=http://gate:4000 sentinel verify
```

## `sentinel version` · `sentinel help`
Print the build version (from the package / `SENTINEL_BUILD_VERSION`) or the usage banner.

**Usage:**
```bash
sentinel version
sentinel help
```

## From source (no install)

```bash
npm run sidecar          # = tsx src/sidecar/main.ts  (run the gate)
npm run cli -- init      # = tsx src/cli/main.ts init
npm run cli -- keygen
```
