# Packaging: what's an SDK, what's the server, what's hidden

Sentinel ships as **three distinct artifacts**. The most common confusion is treating "the SDK" and "the thing you self-host" as the same — they're not.

| Artifact | What it is | Who installs it | Contains |
|---|---|---|---|
| **SDK** (TS + Python) | The *thin client* your agent imports to call `guard()` | Your **agent** code | `SentinelClient` + `Action` builders + wire types. **Nothing else.** Zero/stdlib deps. |
| **Server** (sidecar/engine) | The gate you **run** | You **self-host** (npm package + CLI, or Docker) | the engine and everything it needs |
| **Control plane + Pro packs** | Multi-tenant aggregation, dashboard, billing, SSO, maintained compliance packs | Commercial customers | the separate control-plane project (distinct repo) |

> The SDK does **not** contain the engine, checks, providers, store, or sidecar. Those are the *server* — a separate package you run. The SDK just sends an HTTP request to it.

## What goes in each SDK (and nothing more)
- `SentinelClient(endpoint, …).guard(action, context, policy) → GuardDecision`
- `SentinelClient.allowed(decision)`
- `Action.payment(…)` / `Action.of(…)` builders
- The wire types: `Action`, `AgentContext`, `Verdict`, `CheckResult`, `GuardDecision`

That's the whole surface. The SDKs are intentionally tiny and dependency-free so an agent can adopt them without pulling in a web server, Postgres driver, or model SDKs.

- **TypeScript:** npm `@montanalabs/sentinel-sdk` (zero dependencies) — a separate package.
- **Python:** PyPI `sentinel-guard` (stdlib only) — a separate package.

> The agent client lives **only** in the standalone `@montanalabs/sentinel-sdk` package — the big `sentinel` server package does not re-export it, so agents never transitively install the server's dependencies.

## What's in the server (this `sentinel/` package)
Run via the `sentinel` CLI or Docker. Open source / source-available — and it **must** stay inspectable, because an "independent gate" you can't read isn't independent (that's the whole moat).

| Folder | Role |
|---|---|
| `src/core` | Action model, canonical JSON, types |
| `src/checks` | schema · policy DSL · reconcile · data-boundary · predicate |
| `src/providers` | second-opinion adapters (Anthropic / OpenAI / mock) |
| `src/connectors` | ground-truth (ledger, clinical) |
| `src/engine` | the verdict engine (tiers, budget, aggregation, HA append) |
| `src/store` | provenance store (in-memory + SQLite + Postgres) |
| `src/provenance` | signing + hash-chain + verify |
| `src/policy-packs` | the free starter packs (fintech, healthcare) |
| `src/sidecar` | the HTTP server + escalations |
| `src/cli` | the `sentinel` CLI |
| `src/analytics` | decision analytics — verdict rates, run coverage, policy back-testing |

## What lives outside this repo
Not the engine — the **layer above it**: the multi-tenant control plane (aggregation, dashboard, billing, SSO) and the **maintained Pro vertical compliance packs** (kept current with regulations, with audit-acceptance). Those live in the separate control-plane project, not in this open-source repo.

## The CLI (`sentinel`)
The self-host entry point.
```bash
npx sentinel init my-gate     # scaffold a project: .env, docker-compose, server.ts + a sample custom pack
npx sentinel keygen           # print a base64 Ed25519 seed for SENTINEL_SIGNING_SEED (stable signer identity)
npx sentinel start            # run the sidecar from .env
npx sentinel verify [url]     # verify the provenance chain of a running sidecar
```
`sentinel init` generates a runnable starting point — a `src/server.ts` that wires your connectors and registers the built-in packs **plus** a `src/my-pack.ts` template — so a self-hoster customizes policy without assembling the engine by hand.

## Publishing checklist
| Package | Registry | Name | Deps |
|---|---|---|---|
| TS SDK | npm | `@montanalabs/sentinel-sdk` | none |
| Python SDK | PyPI | `sentinel-guard` | none (stdlib) |
| Server | npm (+ Docker image) | `sentinel` (or `@montanalabs/sentinel`) | fastify, pg, ajv, providers |

**Licensing (recommended split):** SDKs → Apache-2.0 (max adoption); server → source-available (FSL/BSL — inspectable + self-hostable, not resaleable as a service); control plane → commercial. *(Names and license are placeholders pending your confirmation.)*
