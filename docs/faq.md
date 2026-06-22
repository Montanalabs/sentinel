# FAQ & troubleshooting

Answers to the questions that come up most when adopting, deploying, and operating Sentinel.

## Conceptual

**How is this different from the agent checking its own output?**
Independence. Sentinel is a separate process that holds the policy and a signing key the agent never
sees, and it reconciles against your *real* systems of record. A model grading its own homework isn't
something an auditor accepts; an independent gate with a signed trail is. See [concepts](./concepts.md).

**Can the independent model BLOCK a payment?**
No — by design. The cross-model second opinion maps **agree → ALLOW** and **disagree → ESCALATE** (and
any provider error → ESCALATE). Hard **BLOCK**s come only from deterministic checks (schema, sanctions,
insufficient funds). So the model can *escalate* a suspicious action for human review, but only the
rules can outright block it. This keeps a non-deterministic model from being the thing that hard-denies.

**Why did a perfectly normal payment ESCALATE instead of ALLOW (with a real model)?**
The second opinion is asked whether the action is consistent with the *user request* and free of fraud
signals, and to agree *only if it's safe as-is*. With no authorizing context in `context.trace`, a good
model conservatively can't confirm safety → ESCALATE. Provide the originating user request / tool call
in the trace and legitimate payments will ALLOW. (Use the `mock` provider for deterministic dev.)

**ALLOW / BLOCK / ESCALATE — who acts on each?**
ALLOW: the agent proceeds. BLOCK: the agent must not act (`reason` says why). ESCALATE: hold for a
human — an `escalationId` is created; resolve it via `POST /v1/escalations/:id/resolve`.

## Setup & running

**Do I need Postgres or Docker?**
No. The store is just `SENTINEL_DATABASE_URL`: `memory` (dev), `sqlite:./sentinel.db` (durable, no
server), or `postgres://…` (durable, HA). Docker is one convenient way to get Postgres, not a
dependency — point the URL at any Postgres (local, RDS, Neon, …) and the sidecar connects directly.

**The wizard started Postgres on port 5433, not 5432 — is that right?**
Yes (since v1.0.1). The bundled Postgres publishes host **5433 → container 5432** so it can't collide
with a Postgres already running natively on 5432. The in-container port is still 5432.

**Why won't a real second-opinion provider work?**
Set `SENTINEL_SECOND_OPINION_PROVIDER=anthropic|openai` *and* the matching `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY`. If the key is missing/invalid the check **fails safe to ESCALATE** (it won't ALLOW),
and the startup log warns. Raise `SENTINEL_SLOW_BUDGET_MS` (real models can take several seconds).

**How do I get a stable signer across restarts?**
`echo "SENTINEL_SIGNING_SEED=$(sentinel keygen)" >> .env`. Without it the key is ephemeral per boot.

## Errors

**`HTTP 400 unknown policy pack: <id>`** — the `policy` string doesn't match a registered pack. Check
spelling (`fintech.payments`, `healthcare.record_write`) or register your custom pack. Fail-closed: no
ALLOW is possible. *(Prior to v1.0.2 this surfaced as a `500`; upgrade for the clean 400.)*

**`HTTP 400 invalid guard request`** — the body failed schema validation; `details` carries the Zod
issues. Required: `action.id`, `action.type`, `action.payload`, `context.runId`, `policy`.

**`HTTP 503 store unavailable` on `/readyz`** — the provenance store isn't reachable (e.g. Postgres
down). The sidecar is live but not ready; your LB should stop routing to it.

**`HTTP 503 overloaded` / `429 rate limit exceeded`** — `SENTINEL_MAX_CONCURRENT` / the rate limit are
configured and tripped. Tune them or scale out.

**`HTTP 409 escalation already resolved`** — that escalation was already approved/denied. **`403
approver not in the escalation approver list`** — the `approver` isn't on the escalation's allowlist
(e.g. high-value escalations require `treasury_ops`). **`404`** — unknown escalation id.

**SDK returns BLOCK with `recordId: ''`** — that's a *transport fail-closed*, not a gate decision: the
sidecar was unreachable, timed out, or returned a non-2xx / malformed body. The synthetic check is
`sentinel.transport`. Check connectivity and `timeoutMs`.

**`/v1/verify` returns `{ ok: false, brokenAt }`** — a record was tampered with or the chain was
spliced at that sequence. Investigate the store; records are append-only and should never be edited.

## Operations

**Can I run multiple sidecars (HA)?** Yes — several behind a load balancer sharing one Postgres
`SENTINEL_DATABASE_URL`. A unique-sequence constraint + retry keeps one verifiable chain. Raise
`SENTINEL_APPEND_RETRIES` under heavy write contention.

**Rolling restarts — do I drop decisions?** No. The sidecar drains in-flight requests on
`SIGTERM`/`SIGINT` before exiting.

**How do I customize packs/connectors without forking?** Drop a `sentinel.config.mjs` in the working
directory (or mount it into the container) exporting `ledger` / `clinical` / `packs`. See
[self-hosting](./self-hosting.md) and [connectors](./connectors.md).

**How do I expose it safely?** Keep it loopback for a true sidecar; if you must listen on `0.0.0.0`,
put it behind an authenticating gateway / mTLS on a private network and enable rate limiting. The
`/v1/*` API is unauthenticated by design. See [security](./security.md).

## Next

- [Concepts](./concepts.md) · [Getting started](./getting-started.md) · [HTTP API](./api-reference.md)
- [Self-hosting & operations](./self-hosting.md) · [Security](./security.md)
- Open an issue (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
