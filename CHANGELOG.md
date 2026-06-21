# Changelog

All notable changes to Sentinel are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-06-21

`sentinel init` onboarding fixes — no API surface change.

- **Bundled Postgres moved to host port `5433`** (container stays 5432) so the wizard's
  `docker compose` Postgres can no longer collide with a Postgres already running natively on 5432.
- **Bring-your-own Postgres is respected.** When `SENTINEL_DATABASE_URL` is set to anything other
  than the bundled compose URL, the wizard no longer starts a Docker container — it connects the
  sidecar straight to your database (native localhost, RDS, Neon, …).
- **No-Docker path is no longer a dead end.** If Docker (or the `docker compose` plugin) is absent,
  the wizard guides you to the zero-infra SQLite store (`sqlite:./sentinel.db`), your own Postgres,
  or installing Docker — instead of failing.
- **Bring-up is branded and fail-loud.** Docker's raw output is hidden behind a Sentinel spinner;
  a failed bring-up (e.g. port in use) now stops with an actionable message rather than silently
  starting the sidecar against the wrong database.

## [1.0.0] - 2026-06-21

First stable release. See **[API stability](./README.md#api-stability--versioning)** for what 1.0.0
commits to. **Read the breaking changes below before upgrading from 0.x.**

### Added

- **Adjudication protocol** (`src/protocol/`): an `ALLOW` decision becomes a signed, single-use,
  expiring **authorization receipt** bound to the exact action/context/policy/evidence; a
  `ProtectedExecutor` enforces it (recomputing the action digest itself), and `auditCompleteMediation`
  proves complete mediation. Fail-safe `adjudicate()` rule with property-based invariants, a declared
  verifier-independence profile, external checkpoints, and durable receipt/execution/nonce stores
  (memory/SQLite/Postgres). Opt-in via `SENTINEL_PROTOCOL_ENABLED`; additive `/v1/adjudications`,
  `/v1/receipts/validate`, `/v1/executions`, `/v1/receipts/revoke`, `/v1/audit/*` routes.
- **Deterministic evaluation harness** (`eval/`) measuring attack-success across defense rungs; runs
  the real components and doubles as a safety-regression suite.
- **`sentinel start --watch`** hot-reloads the sidecar on `.env` / `sentinel.config.*` save (reuses one
  signer so the chain stays continuous); enabled automatically by `init`'s auto-start.
- **Startup preflight** that warns when a non-mock second-opinion provider lacks its API key.
- **Graceful shutdown** (SIGTERM/SIGINT drains in-flight requests) and a **`/readyz`** readiness probe
  (`/healthz` stays liveness-only).
- **Deployment guide** (`docs/deploying.md`: EC2/EKS/ECS) + a ready Kubernetes manifest
  (`deploy/k8s/sentinel.yaml`), and the published GHCR image `ghcr.io/montanalabs/sentinel`.
- Standalone-binary install (`sentinel-{darwin,linux,win}-*`) via `curl|bash` / `irm|iex`, and a CI
  workflow running typecheck + tests + eval (plus a Postgres integration job).
- Branded CLI hero/start banners (truecolor gradient with light/dark/NO_COLOR fallbacks); CLI version
  resolved from `package.json`.
- SQLite provenance backend; sidecar `bodyLimit`/backpressure/batch rate-limit; bounded-memory
  `/v1/verify` + `/v1/analytics`; `/v1/export` paging; key-rotation via `SENTINEL_TRUSTED_KEY_IDS`.

### Changed

- **BREAKING — the key id is now the full SHA-256** of the public key (was a 16-hex/64-bit prefix). A
  truncated id let a store-write attacker forge a colliding key; the full digest requires a SHA-256
  second preimage. Records, receipts, execution receipts, and checkpoints from earlier builds carry
  the old short id and will not verify under 1.0.0.
- **BREAKING — the sidecar binds `127.0.0.1` by default** (was `0.0.0.0`). The `/v1/*` API is
  unauthenticated; set `SENTINEL_HOST=0.0.0.0` to expose it (the container image does) behind a
  trusted boundary.
- **BREAKING — provenance content-hash format**: verification pins to trusted signer key id(s) and
  binds `signerPublicKey` into the content hash; chains signed by pre-1.0 builds do not verify.
- Engine fails safe on a throwing/late check and on a policy with no runnable checks (ESCALATE).
- Policy DSL numeric comparisons coerce decimal strings consistently across operators.

### Fixed

- `auditCompleteMediation` now audits only real executions (`SUCCEEDED`/`FAILED`/`PARTIALLY_COMPLETED`),
  not `REJECTED` refusals — a correctly-blocked attack no longer produces a false violation or poisons
  `/v1/audit/verify`.
- Install scripts: download progress bar, Intel-macOS (`darwin-x64`) cross-build, and correct Windows
  user-PATH handling in `install.cmd`.

### Removed

- The bundled `/dashboard` HTML console (an unauthenticated AI-prototype that could approve/deny
  escalations) and its routes. The `/v1/analytics`, `/v1/records`, `/v1/verify`, and `/v1/escalations`
  APIs it consumed remain.

### Security

- Loopback-by-default bind (above); full-key chain pinning (above).
- **Durable Postgres protocol stores** (nonce/receipt/execution): the single-use replay guarantee no
  longer silently degrades to per-instance in the HA Postgres topology.
- Hardened agent SDK (fails closed on a malformed/unreachable sidecar); redacted store-URL credentials
  in errors; non-root Docker runtime; safe numeric env parsing.

> _The `v0.2.0`–`v0.2.7` tags were pre-1.0 development releases used to exercise the standalone-binary
> and container release pipeline; their changes are consolidated into 1.0.0 above and are not
> documented as separate entries._

## [0.1.0]

- Initial release: SDK + sidecar + verdict engine, signed hash-chained provenance, fintech and
  healthcare policy packs, cross-model second opinion (Anthropic/OpenAI/mock).
