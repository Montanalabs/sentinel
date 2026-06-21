# Sentinel

**The independent verification & action-gate for AI agents.** The model proposes a consequential action; Sentinel independently verifies it, returns **ALLOW / BLOCK / ESCALATE**, and emits a **signed, tamper-evident provenance record** for every decision — the auditor-grade receipt a regulated buyer needs and that a model vendor structurally cannot provide for its own model.

> The model proposes; Sentinel disposes — and signs the receipt.

## Why it exists

When an agent is about to do something irreversible — move money, write a record, send a mail, close a ticket — there is usually **no independent, buyer-owned check** between the decision and the action. Teams hand-roll brittle guards or trust the model vendor's own "recovery," which an auditor cannot accept (a vendor certifying its own model is a conflict of interest). Sentinel is that independent gate, and it gets **more** valuable as models are trusted with higher-stakes actions.

## Architecture

```
            ┌──────────────── Buyer environment (VPC / on-prem) ─────────────-----───┐
  Agent ──► │ [Sentinel SDK] ──guard(action,context,policy)──► [Sentinel Sidecar].   │
 (Claude/   │    thin shim                                       │ Verdict Engine    │
  GPT/…)    │       ▲                                            │  ├ schema         │
            │       └──── ALLOW | BLOCK | ESCALATE ◄─────────────┤  ├ policy DSL     │
  execute() only on ALLOW                                        │  ├ reconcile      │──► ground-truth
            │                                                    │  ├ data-bound.    │    (ledger/EHR)
            │                          signed, hash-chained ◄────┤  └ 2nd opinion    │──► Claude / GPT
            │                          provenance record         │ [Provenance]      │    (independent)
            │                   ESCALATE ─► review queue ─► Slack/ServiceNow webhook │
            └──────────────────────────────────┬──────────────────---────────────────┘
                                        [Control plane] policy bundles · aggregation · GRC export → Vanta/Drata
```

**Trust model:** the sidecar is a separate trust boundary from the agent. It holds the policy, renders the verdict, and signs the record with a key the agent never sees. Independence is enforced by isolation.

## Checks (run as a fast sync tier + a slow async tier with a deadline)

| Check                       | Tier | What it does                                                                                                    |
| --------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| `schema`                    | fast | JSON-Schema validation of the action payload                                                                    |
| `policy:<id>`               | fast | Declarative, sandboxed rule DSL → allow / block / require-approval                                              |
| `data-boundary`             | fast | Blocks PII/PHI routed to a non-cleared provider/region                                                          |
| `reconcile:<field>`         | slow | Reconciles a number (e.g. amount) against a ground-truth source; **escalates** if the source is unavailable     |
| `counterparty-sanctions`    | slow | Ledger-backed sanctioned-counterparty denial                                                                    |
| `second-opinion:<provider>` | slow | An **independent** model (Claude/GPT) re-checks; disagreement → ESCALATE; provider error → ESCALATE (fail-safe) |

Aggregation precedence: **BLOCK > ESCALATE > ALLOW**. A fast BLOCK short-circuits the slow tier (no wasted model spend).

## Documentation

- **[Self-hosting Sentinel](./docs/self-hosting.md)** — run the sidecar in your own environment
- **TypeScript SDK** (`@montanalabs/sentinel-sdk` on npm) · **Python SDK** (`sentinel-guard` on PyPI) — the thin clients your agent imports to call the gate (published as separate packages)

## Run locally (clone → start)

**Option A — Docker (with Postgres), one command:**

```bash
git clone <repo> && cd sentinel
docker compose up --build            # → http://localhost:4000/dashboard
```

No API keys needed (defaults to the `mock` second-opinion provider). Add a `.env` with real keys to use Anthropic/OpenAI.

**Option B — Node, no Docker (in-memory):**

```bash
git clone <repo> && cd sentinel
npm install
npm run sidecar                      # → http://localhost:4000/dashboard  (in-memory store, mock provider)
```

Then send your first gated action — see **[docs/getting-started.md](./docs/getting-started.md)**.

## Quick start (development)

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY / OPENAI_API_KEY (or keep provider=mock)
npm test                      # 240+ unit tests, no external services
npm run demo                  # boots a real sidecar, drives it over HTTP end-to-end
npx sentinel init my-gate     # scaffold a customized self-host project
```

### Run the sidecar

```bash
npm run sidecar               # listens on SENTINEL_SIDECAR_PORT (default 4000)
```

Open **`http://localhost:4000/dashboard`** for the console: live decision feed, chain-verify badge, decision analytics (allow/block/escalate rates), and a human review queue to approve/deny escalations (each resolution appends a signed `human.review` record). It's a zero-build, same-origin UI served by the sidecar over the `/v1` API.

### Use the SDK from an agent

The agent-side SDK is a separate, **dependency-free** package — `@montanalabs/sentinel-sdk` (npm) — so installing it in an agent pulls in no server/DB/model libraries:

```ts
import { SentinelClient, Action } from "@montanalabs/sentinel-sdk"; // zero runtime deps

const sentinel = new SentinelClient({ endpoint: "http://localhost:4000" }); // fail-closed by default

const action = Action.payment({
  amount: 42_000,
  from: "acct_ops",
  to: "vendor_42",
});
const decision = await sentinel.guard(
  action,
  { runId, provider: "anthropic" },
  "fintech.payments",
);

if (SentinelClient.allowed(decision)) {
  await executePayment(action); // only runs on ALLOW
} else {
  handle(decision); // BLOCK reason, or ESCALATE -> review queue (decision.escalationId)
}
```

### HTTP API

| Method & path                                                            | Purpose                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `POST /v1/guard`                                                         | Gate one action → decision (+ `escalationId` when ESCALATE) |
| `POST /v1/guard/batch`                                                   | Gate a multi-agent fan-out in one linked chain              |
| `GET /v1/records[?verdict=&tenant=&runId=&since=&until=&limit=&offset=]` | Query provenance                                            |
| `GET /v1/records/:id`                                                    | One record                                                  |
| `GET /v1/verify`                                                         | Verify the whole hash-chain is intact                       |
| `GET /v1/export`                                                         | Export records (feed a GRC platform)                        |
| `GET /v1/escalations[?status=pending]`                                   | Review queue                                                |
| `POST /v1/escalations/:id/resolve`                                       | Human approve/deny → appends a signed `human.review` record |

## Rate limiting & backpressure

The sidecar can enforce a global token-bucket rate limit (429) and a concurrency cap (503) on `/v1/*` (liveness `/healthz` is exempt):

```bash
SENTINEL_RATE_LIMIT_BURST=200 SENTINEL_RATE_LIMIT_RPS=100 SENTINEL_MAX_CONCURRENT=64 npm run sidecar
```

## Packaging

`npm run build` emits `dist/` with declarations. The package `exports` map exposes `.`, `./sidecar`, and `./policy-packs`. The agent-side client is a separate package (`@montanalabs/sentinel-sdk`). `npm publish` runs the build via `prepublishOnly`.

## Provenance

Every decision is an append-only, **hash-chained** record signed with **Ed25519**. `GET /v1/verify` (or `verifyChain()`) recomputes each content hash, checks the chain links, and verifies every signature — any insertion, deletion, or edit is detected. Records survive restarts: the sidecar resumes the chain from the persisted tail. Concurrency is safe at two levels: the append critical section is **serialized within an engine** (so concurrent requests to one sidecar can't corrupt the chain), and **across sidecars** a Postgres unique-seq constraint plus optimistic re-resume/retry keeps one fork-free chain (covered by a real-Postgres concurrent-writer stress test).

## Policy packs

Built-in vertical packs (configurable, composable):

- **`fintech.payments`** — schema, dual-control on high-value transfers, sanctioned-counterparty denial (static + ledger), balance reconciliation, second opinion.
- **`healthcare.record_write`** — schema, clinician sign-off on clinically-significant changes, PHI data-boundary, **patient-exists verification** against a clinical (FHIR-style) connector, second opinion.

```ts
import { defaultRegistry, fintechPaymentsPack } from "sentinel";
const registry = defaultRegistry(
  { ledger, provider },
  { fintech: { highValueThreshold: 25_000 } },
);
```

## Control plane

Multi-sidecar aggregation, signed-bundle distribution, GRC export, and OpenTelemetry export live in the **separate, commercial control-plane project** — not in this open-source gate. Self-hosters get the raw signed records via `GET /v1/export` to feed their own pipeline.

## Analytics & safe rollout

- `analyze(records)` — verdict rates, breakdowns, top block/escalation reasons.
- `runCoverage(records, runId)` — every gated action in a (multi-agent) run + duplicate-action detection.
- `simulate(records, candidateChecks)` — **back-test** a policy change against history without emitting records.

## Testing

```bash
npm test                      # unit tests (no external services)
docker run -d --name sentinel-pg -e POSTGRES_USER=sentinel -e POSTGRES_PASSWORD=sentinel \
  -e POSTGRES_DB=sentinel -p 5433:5432 postgres:17-alpine
npm run test:int              # integration: Postgres store + live Anthropic/OpenAI + real-HTTP boot
npm run typecheck && npm run build
```

Integration tests self-skip when their dependency (DB URL / API key) is absent.

## Project layout

```
src/
  core/         types, Action model, canonical JSON
  provenance/   Ed25519 signing, hash-chain records, verify
  store/        ProvenanceStore: in-memory + SQLite + Postgres (+ shared contract)
  checks/       schema · policy DSL · reconcile · data-boundary · predicate
  engine/       verdict engine: tiers, budget, aggregation, serialized+HA append, batch
  providers/    second-opinion: Anthropic · OpenAI · mock
  connectors/   ground-truth: static/HTTP ledger · static/FHIR clinical
  policy-packs/ registry + fintech & healthcare packs
  sidecar/      Fastify server, dashboard, escalations, rate-limit, bootstrap, main
  cli/          the `sentinel` CLI: init · start · keygen · verify
  analytics/    analytics · run coverage · policy simulation
examples/demo.ts
```

## Security notes

- Keep real API keys in **`.env`** (gitignored). **Do not** put live secrets in `.env.example` (it is tracked). Rotate any key that has been committed.
- Default fail modes are **safe**: the SDK fails **closed** (BLOCK) if the sidecar is unreachable; the engine **escalates** when a slow check times out or a ground-truth source is unavailable.
- For PHI/PCI, run the sidecar in-VPC/on-prem so prompts/outputs never leave the trust boundary.

## Status

240+ unit tests + integration tests, all green. The cross-model second opinion supports Anthropic
and OpenAI (or a built-in `mock` provider for offline/dev), and the provenance store supports
in-memory, SQLite, and Postgres. **You bring your own** model provider, API key, and database — set
them in your `.env` (see [Getting started](./docs/getting-started.md) and
[Self-hosting](./docs/self-hosting.md)); Sentinel ships none of these credentials.

## Contributing & security

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) and our
[Code of Conduct](./CODE_OF_CONDUCT.md). Found a vulnerability? Please report it privately per our
[Security Policy](./SECURITY.md) rather than opening a public issue.

## License

[Apache-2.0](./LICENSE) © Montana Labs.
