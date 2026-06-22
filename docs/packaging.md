# Distribution & artifacts

Sentinel ships as three artifacts. The SDK (what your agent imports) and the self-hosted server (the gate you run) are different things — installing one is not installing the other.

| Artifact | What it is | Who installs it | Contains |
|---|---|---|---|
| **SDK** (TS + Python) | The *thin client* your agent imports to call `guard()` | your **agent** code | `SentinelClient` + `Action` builders + wire types — nothing else (zero / stdlib deps) |
| **Server** (sidecar) | The gate you **run** | you **self-host** — standalone binary, Docker, or from source | the engine, checks, providers, store, and HTTP server |
| **Control plane** | Multi-tenant aggregation, dashboard, SSO, maintained compliance packs | commercial customers | a separate project (distinct repo, not included here) |

> The SDK does **not** contain the engine, checks, providers, store, or sidecar — those are the *server*. The SDK only sends an HTTP request to it, so an agent never transitively installs the server's dependencies.

## What's in each SDK
- `new SentinelClient(opts).guard(action, context, policy)` → `GuardDecision`
- `SentinelClient.allowed(decision)`
- `Action.payment(…)` / `Action.of(…)` builders
- The wire types: `Action`, `AgentContext`, `Verdict`, `CheckResult`, `GuardDecision`

That's the whole surface — intentionally tiny and dependency-free, so adopting it never pulls in a web server, a Postgres driver, or a model SDK.

- **TypeScript** — `@montanalabs/sentinel-sdk` (npm, zero dependencies)
- **Python** — `sentinel-guard` (PyPI, stdlib only)

## What's in the server (this `sentinel` package)
Run it via the `sentinel` CLI, the Docker image, or from source. It is source-available and stays inspectable — an independent gate you can't read isn't independent.

| Folder | Role |
|---|---|
| `src/core` | action model, canonical JSON, types |
| `src/checks` | schema · policy DSL · reconcile · data-boundary · predicate |
| `src/providers` | second-opinion adapters (Anthropic / OpenAI / mock) |
| `src/connectors` | ground-truth connectors (ledger, clinical) |
| `src/engine` | the verdict engine (tiers, budget, aggregation, HA append) |
| `src/store` | provenance store (memory + SQLite + Postgres) |
| `src/provenance` | signing + hash-chain + verify |
| `src/policy-packs` | the built-in packs (fintech, healthcare) |
| `src/sidecar` | the HTTP server + escalations |
| `src/cli` | the `sentinel` CLI |
| `src/analytics` | decision analytics — verdict rates, coverage, back-testing |

## How each artifact is distributed

| Artifact | Distribution |
|---|---|
| TypeScript SDK | npm — `@montanalabs/sentinel-sdk` |
| Python SDK | PyPI — `sentinel-guard` |
| Server | standalone binary (GitHub Releases) + Docker image (GHCR); not published to npm |

The multi-tenant control plane and the maintained vertical compliance packs live in a separate project, not in this repository.
