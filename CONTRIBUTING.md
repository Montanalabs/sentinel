# Contributing to Sentinel

## Dev setup
```bash
npm install
npm run sidecar        # run the gate locally (in-memory, mock provider) on :4000
npm run demo           # end-to-end demo over HTTP
```
Requires Node ≥ 22.5 (the built-in `node:sqlite` store backend needs it). No services needed for unit tests.

## Tests
```bash
npm test               # unit tests (no external services)
npm run typecheck      # tsc --noEmit (must be clean)
npm run build          # emit dist/

# integration tests need a Postgres (and, for live provider tests, API keys):
docker run -d --name sentinel-pg -e POSTGRES_USER=sentinel -e POSTGRES_PASSWORD=sentinel \
  -e POSTGRES_DB=sentinel -p 5433:5432 postgres:17-alpine
docker exec sentinel-pg createdb -U sentinel sentinel_test
SENTINEL_TEST_DATABASE_URL=postgres://sentinel:sentinel@localhost:5433/sentinel_test npm run test:int
```
**All work is test-driven** — write the failing test first, watch it fail, then implement. Keep `npm test` and `npm run typecheck` green.

## Project layout
```
src/core         types, Action model, canonical JSON
src/checks       schema · policy DSL · reconcile · data-boundary · predicate
src/providers    second-opinion adapters (Anthropic / OpenAI / mock)
src/connectors   ground-truth (ledger, clinical)
src/engine       verdict engine (tiers, budget, aggregation, HA append)
src/store        provenance store (in-memory + SQLite + Postgres)
src/provenance   signing + hash-chain + verify
src/policy-packs registry + built-in packs
src/sidecar      HTTP server, escalations, bootstrap, adjudication-protocol routes
src/cli          the `sentinel` CLI (init / start / keygen / verify)
docs/            self-hosting, API, policy packs, connectors, SDK guides
(SDKs are separate packages: `@montanalabs/sentinel-sdk` on npm + `sentinel-guard` on PyPI)
```

## Adding a check or pack
- New **check**: implement `Check { name, tier, run(input) }` in `src/checks/`, with a `*.test.ts` first. See [docs/policy-packs.md](./docs/policy-packs.md).
- New **pack**: a `PolicyPack { id, build(deps) }` in `src/policy-packs/`; register it in `defaultRegistry` or load via `sentinel.config.mjs`.
- New **connector**: implement `LedgerConnector` / `ClinicalConnector` (or any source) in `src/connectors/`; fail lookups *safe* (return undefined/unknown → the gate ESCALATES).

## Conventions
- TypeScript strict; no `any` without cause.
- Checks/connectors must **fail safe** (ESCALATE/BLOCK, never silently ALLOW on uncertainty).
- Don't break the provenance format without a chain-version bump.
- Run `npm test && npm run typecheck && npm run build` before opening a PR.
