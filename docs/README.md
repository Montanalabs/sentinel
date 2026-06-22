# Sentinel documentation

The open-source **independent action-gate** for AI agents: a self-hosted sidecar plus thin SDKs your
agents call at the action boundary. The model proposes a consequential action → the SDK submits it to
the sidecar → the sidecar **independently** verifies it against your policy and systems of record and
returns **ALLOW / BLOCK / ESCALATE**, with a **signed, tamper-evident provenance record** for every
decision.

## Start here
- **[Concepts & architecture](./concepts.md)** — how it works, the trust model, the two tiers, the
  three verdicts, and fail-safe by construction. *Read this first.*
- **[Getting started](./getting-started.md)** — zero → a gated action with a signed record, in ~10 min.

## Use it
- **[CLI reference](./cli.md)** — `init`, `start`, `keygen`, `verify`; install & Docker.
- **[SDK reference](./sdk.md)** — the TypeScript / Python client API, options, and fail-closed behaviour.
- **[HTTP API reference](./api-reference.md)** — every route, request/response schema, status codes.

## Configure it
- **[Policy packs & the rule DSL](./policy-packs.md)** — built-in packs, the data-only rule language,
  the full checks reference, and writing a custom pack step by step.
- **[Connectors](./connectors.md)** — reconcile against your own ledger / EHR / systems of record
  (and write your own), with fail-safe lookups.

## Run it
- **[Self-hosting & operations](./self-hosting.md)** — requirements, the full configuration table,
  deployment, HA, embedding.
- **[Deploying (EC2 / EKS / ECS / k8s)](./deploying.md)** — step-by-step infra guides + a ready
  Kubernetes manifest.
- **[Persistence & storage](./persistence.md)** — memory / SQLite / Postgres, what's stored where,
  schema, HA, backups, retention.
- **[Security & trust model](./security.md)** — what it protects, what it assumes, and the deployment
  checklist.

## Understand the audit trail
- **[Provenance & audit](./provenance.md)** — the signed record format, the hash chain, and how
  `verify` works.
- **[The adjudication protocol](./adjudication-protocol.md)** — the optional stronger guarantee:
  execution-bound, single-use authorization receipts + complete-mediation audit.

## Reference
- **[FAQ & troubleshooting](./faq.md)** — common questions, error codes, and fixes.
- **[Packaging](./packaging.md)** — the artifacts (SDK · self-hosted server · commercial control plane),
  the `sentinel` CLI, and the publish/license plan.

## SDKs
- **TypeScript** — `@montanalabs/sentinel` (zero-dependency client)
- **Python** — `montanalabs-sentinel` (stdlib-only)

Both are published separately; until a package is on your registry you can vendor the client from the
`sentinel-sdks/` source (no third-party deps). See the [SDK reference](./sdk.md).

---
Looking for the multi-tenant aggregation layer (dashboard, analytics, billing, SSO)? That's the
separate control-plane project (a distinct repo, not included here).
