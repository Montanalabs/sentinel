# Self-hosting Sentinel

Sentinel is the **independent verification & action-gate** for AI agents. You run the **sidecar** in your own environment; your agent calls it through an SDK at the moment it is about to take a consequential action. The sidecar independently verifies the action, returns **ALLOW / BLOCK / ESCALATE**, and writes a **signed, tamper-evident provenance record** for every decision.

> Trust model: the sidecar is a separate trust boundary from the agent. It holds the policy, renders the verdict, and signs records with a key the agent never sees. That independence is the point — a model vendor certifying its own model's output is not something an auditor can accept.

## Requirements
- Node.js ≥ 20
- (Optional) Postgres for durable provenance — without it, an in-memory store is used (fine for dev).
- (Optional) An Anthropic and/or OpenAI API key for the cross-model "second opinion" check (or run with the `mock` provider).

## Quick start
```bash
cd sentinel
npm install
cp .env.example .env          # edit as needed (or leave defaults for an in-memory dev run)
npm run sidecar               # listens on http://localhost:4000
```
Check it:
```bash
curl localhost:4000/healthz                       # {"status":"ok"}
open http://localhost:4000/dashboard              # decision feed, chain-verify, review queue
```

## Configuration (environment)
| Variable | Purpose | Default |
|---|---|---|
| `SENTINEL_SIDECAR_PORT` | Port to listen on | `4000` |
| `SENTINEL_DATABASE_URL` | provenance store: `memory` (dev) · `sqlite:./sentinel.db` (durable, no server; needs Node ≥ 22.5) · `postgres://…` (durable, HA) | in-memory |
| `SENTINEL_SECOND_OPINION_PROVIDER` | `anthropic` \| `openai` \| `mock` | `mock` |
| `SENTINEL_SECOND_OPINION_MODEL` | Model id for the second opinion | `claude-sonnet-4-6` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Keys for the real second-opinion provider | — |
| `SENTINEL_SLOW_BUDGET_MS` | Deadline for slow checks (model/ledger calls) | 2000 (mock) / 12000 (real) |
| `SENTINEL_SIGNING_SEED` | base64 Ed25519 seed → **stable signer key id** across restarts | ephemeral |
| `SENTINEL_ESCALATION_WEBHOOK_URL` | POSTed when an action escalates (Slack/ServiceNow) | — |
| `SENTINEL_RATE_LIMIT_BURST` + `SENTINEL_RATE_LIMIT_RPS` | Token-bucket rate limit on `/v1/*` (429) | off |
| `SENTINEL_MAX_CONCURRENT` | Max in-flight `/v1/*` requests (503) | off |

For production set `SENTINEL_SIGNING_SEED` (so the provenance signer is stable and verifiable across restarts) and `SENTINEL_DATABASE_URL` (so the chain is durable).

## HTTP API
| Method & path | Purpose |
|---|---|
| `GET /healthz` | Liveness |
| `GET /dashboard` · `GET /` | Built-in console (feed, chain-verify, review queue) |
| `POST /v1/guard` | Gate one action → `{ verdict, recordId, checks, reason?, escalationId? }` |
| `POST /v1/guard/batch` | Gate a multi-agent fan-out in one linked chain |
| `GET /v1/records[?verdict=&tenant=&runId=&since=&until=&limit=&offset=]` | Query provenance |
| `GET /v1/records/:id` | One record |
| `GET /v1/verify` | Verify the whole hash-chain → `{ ok, brokenAt?, reason? }` |
| `GET /v1/export` | Export records (feed a GRC platform / control plane) |
| `GET /v1/escalations[?status=pending]` | Human review queue |
| `POST /v1/escalations/:id/resolve` | `{ decision: approve\|deny, approver }` → appends a signed `human.review` record |

### Guard request/response
```jsonc
// POST /v1/guard
{
  "action":  { "id": "act_1", "type": "payment", "payload": { "amount": 42000, "from": "acct_ops", "to": "vendor_42" } },
  "context": { "runId": "run_1", "provider": "anthropic", "model": "claude-sonnet-4-6",
               "actor": { "id": "agent-007", "roles": ["ops"] }, "tenant": "acme" },
  "policy":  "fintech.payments"
}
// 200
{ "verdict": "ESCALATE", "recordId": "rec_…", "reason": "…requires dual-control sign-off",
  "escalationId": "esc_…", "checks": [ /* per-check results */ ] }
```

## Policy packs
The sidecar resolves a `policy` string to an ordered set of **checks** run as a fast (sync) tier + a slow (async, deadline-bounded) tier. Aggregation precedence is **BLOCK > ESCALATE > ALLOW**; a fast BLOCK short-circuits the slow tier (no wasted model spend).

Built-in packs:
- **`fintech.payments`** — schema validation, dual-control on high-value transfers, sanctioned-counterparty denial (static list + ledger connector), balance reconciliation, optional cross-model second opinion.
- **`healthcare.record_write`** — schema, clinician sign-off on clinically-significant changes, PHI data-boundary enforcement, patient-exists verification (clinical connector), optional second opinion.

Configure and register packs when embedding (see below):
```ts
import { defaultRegistry } from 'sentinel';
const registry = defaultRegistry(
  { ledger, clinical, provider },                       // ground-truth + second-opinion deps
  { fintech: { highValueThreshold: 25_000, approvers: ['treasury_ops'] } },
);
```

### Checks you can compose into a custom pack
`SchemaCheck` (JSON Schema) · `PolicyCheck` (a safe, data-only rule DSL → allow/block/require-approval) · `NumericReconcileCheck` (reconcile a number against a source of truth) · `DataBoundaryCheck` (PII/PHI → cleared provider/region) · `PredicateCheck` (any async predicate, e.g. a connector lookup) · `SecondOpinionCheck` (independent Claude/GPT review). See `src/checks/` and `src/policy-packs/`.

## Ground-truth connectors
Checks reconcile against **your** systems of record:
- **Ledger:** `StaticLedgerConnector` (dev) or `HttpLedgerConnector(baseUrl)` (calls `/accounts/:id/balance`, `/counterparties/:id`; fails safe → reconcile **escalates** if the source is unreachable).
- **Clinical (FHIR-style):** `StaticClinicalConnector` or `HttpFhirConnector(baseUrl)` (`/Patient/:id`, `/Patient/:id/allergies`).

## Provenance & verification
Every decision is an append-only, **hash-chained** record signed with **Ed25519**. `GET /v1/verify` recomputes each content hash, checks the links, and verifies every signature — any insert/delete/edit is detected. Records survive restarts (the sidecar resumes the chain from the persisted tail). Concurrency is safe at two levels: the append critical section is serialized within a process, and across processes a Postgres unique-seq constraint plus optimistic retry keeps one fork-free chain.

## The server is a package + image, not generated code
You don't scaffold or fork the engine — you run a published artifact and configure it. Three ways, increasing in customization:

### 1. CLI (npm)
```bash
npx sentinel start          # runs the gate from .env  (npx sentinel keygen, init, verify too)
```

### 2. Docker (stock image)
```bash
docker build -t sentinel .                 # or pull the published image
docker run -p 4000:4000 --env-file .env sentinel
```
The image's entrypoint is `sentinel start`. With Postgres via compose:
```yaml
services:
  postgres: { image: postgres:17-alpine, environment: { POSTGRES_USER: sentinel, POSTGRES_PASSWORD: sentinel, POSTGRES_DB: sentinel }, ports: ["5433:5432"] }
  sentinel:
    image: sentinel
    env_file: .env
    environment: { SENTINEL_DATABASE_URL: postgres://sentinel:sentinel@postgres:5432/sentinel }
    ports: ["4000:4000"]
    depends_on: [postgres]
```

### 3. Scaffold a customized project (interactive wizard)
```bash
npx sentinel init my-gate    # asks: port, provider, store, which packs, custom pack, signing seed
                             #  then scaffolds a tailored project and offers to install + start
npx sentinel init my-gate --yes   # non-interactive (defaults), for CI/scripts
```
The wizard generates a thin project that **depends on** `sentinel` (the engine stays a dependency — upgrades via `npm update sentinel`, nothing forked). It writes a `src/server.ts` wired to exactly the packs/connectors you chose, a `src/my-pack.ts` template (if requested), `.env` pre-filled, a `Dockerfile`, and `docker-compose.yml`. At the end it can run `npm install` and `npm start` for you.

### Plug in connectors & custom packs without forking (config file)
The stock CLI/image loads an optional **`sentinel.config.mjs`** (or `.js`, or `SENTINEL_CONFIG=path`) from the working directory:
```js
// sentinel.config.mjs — loaded by `sentinel start` / the Docker image
import { HttpLedgerConnector } from 'sentinel';
import { myPack } from './my-pack.js';
export const ledger = new HttpLedgerConnector('https://ledger.internal');
export const packs = [myPack()];
```
Mount it into the container (`-v $PWD/sentinel.config.mjs:/app/sentinel.config.mjs`) to customize the official image without rebuilding.

### Operational notes
- **As a sidecar:** run next to your agent (same pod/host); the SDK talks to it over localhost.
- **Regulated data (PHI/PCI):** run in-VPC/on-prem; point connectors at internal systems.
- **HA:** several sidecars behind a load balancer sharing one Postgres `SENTINEL_DATABASE_URL`; the unique-seq constraint + retry guarantees a single, verifiable chain.
- **Embedding:** for full control, assemble the app yourself with `buildSentinel(config, { ledger, clinical, extraPacks })` or the lower-level `buildServer`.

## Feeding a control plane / GRC
`GET /v1/export` returns the signed records; push them to the separate Sentinel control-plane project (multi-tenant aggregation, analytics, signed-bundle distribution, GRC export, OTLP) or feed them into your own evidence pipeline.

## Security notes
- Keep API keys in `.env` (gitignored); never in `.env.example` (tracked).
- Defaults fail safe: the **SDK** fails *closed* (BLOCK) if the sidecar is unreachable; the **engine** *escalates* when a slow check times out or a ground-truth source is unavailable.
- Set `SENTINEL_SIGNING_SEED` in production and store it as a secret — it is the identity that signs your audit trail.

## Next
- TypeScript SDK → `@montanalabs/sentinel-sdk` (npm)
- Python SDK → `sentinel-guard` (PyPI)
