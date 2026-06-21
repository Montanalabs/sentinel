# Sentinel documentation

The open-source **edge gate**: a self-hosted sidecar plus thin SDKs your agents call at the action boundary. The model proposes a consequential action → the SDK submits it to the sidecar → the sidecar independently verifies it and returns **ALLOW / BLOCK / ESCALATE** with a signed, tamper-evident provenance record.

## Start here
- **[Getting started](./getting-started.md)** — zero → a gated action with a signed record, in TS *and* Python.

## Run it
- **[Self-hosting & operations](./self-hosting.md)** — requirements, configuration, deployment, HA, security.
- **[HTTP API reference](./api-reference.md)** — every route, request/response schema, status codes.

## Configure it
- **[Policy packs & the rule DSL](./policy-packs.md)** — built-in packs, the data-only rule language, the full checks reference, and writing a custom pack step by step.
- **[Connectors](./connectors.md)** — reconcile against your own ledger / EHR / systems of record (and write your own).

## Integrate it
- **TypeScript SDK** — `@montanalabs/sentinel-sdk` on npm (zero-dep)
- **Python SDK** — `sentinel-guard` on PyPI (stdlib-only)

## How it's packaged
- **[Packaging](./packaging.md)** — the three artifacts (SDK vs. self-hosted server vs. commercial control plane), what each contains, the `sentinel` CLI, and the publish/license plan.

---
Looking for the multi-tenant aggregation layer (dashboard, analytics, billing, SSO)? That's the separate control-plane project (a distinct repo, not included here).
