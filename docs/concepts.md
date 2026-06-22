# Concepts & architecture

Sentinel is an **independent action-gate** for AI agents. It sits between an agent's *decision* and a
*consequential action* (moving money, writing a medical record, calling an external API) and answers
one question, with evidence: **may this action proceed?**

## The core idea

An agent that checks its own output is marking its own homework. Sentinel is a **separate trust
boundary**: it holds the policy, reconciles the proposed action against your real systems of record,
optionally asks an *independent* model for a second opinion, and renders a verdict it **signs with a
key the agent never sees**. That independence is what makes the resulting audit trail acceptable to a
reviewer — the thing approving the action is not the thing that proposed it.

```
┌──────────┐   proposed action    ┌─────────────────────────┐   ground truth   ┌──────────────┐
│  agent   │ ───────────────────▶ │   Sentinel sidecar      │ ───────────────▶ │ your ledger/ │
│ (+ SDK)  │                      │   (separate process)    │ ◀─────────────── │ EHR / APIs   │
│          │ ◀─────────────────── │                         │                  └──────────────┘
└──────────┘  ALLOW/BLOCK/ESCALATE│  policy · checks · sign │
                                   └───────────┬─────────────┘
                                               │ append-only, signed
                                               ▼
                                   ┌─────────────────────────┐
                                   │ hash-chained provenance │  ← every decision, tamper-evident
                                   └─────────────────────────┘
```

## The two components

- **Sidecar** — a self-hosted HTTP service (the gate). You run it in your own environment, next to
  your agent or on a private network. It owns the policy, the connectors, the signing key, and the
  provenance store. See [self-hosting](./self-hosting.md) and the [HTTP API](./api-reference.md).
- **SDK** — a thin, dependency-light client your agent calls at the action boundary. It submits the
  action and returns the verdict. It does **not** make the decision — the sidecar does. If the sidecar
  is unreachable the SDK **fails closed** (BLOCK), so a network blip can never silently green-light an
  action. See the [SDK reference](./sdk.md).

## The three verdicts

| Verdict | Meaning | Who acts |
|---|---|---|
| **ALLOW** | Proceed. All checks passed. | the agent executes |
| **BLOCK** | Do not execute. A hard rule failed (bad schema, sanctioned counterparty, insufficient funds). | the agent must not act |
| **ESCALATE** | Hold for a human. Uncertain, high-value, or the independent model disagrees. | routed to the approve/deny queue |

Every call — whatever the verdict — produces exactly one signed provenance record.

## How a decision is made

The sidecar resolves the `policy` string (e.g. `fintech.payments`) to an ordered list of **checks**,
run in two tiers:

1. **Fast tier (synchronous)** — structural and rule checks: JSON-schema validation, the data-only
   [policy rule DSL](./policy-packs.md#the-rule-dsl-policycheck) (dual-control, deny-lists), data-boundary
   (PII/PHI) checks.
2. **Slow tier (async, deadline-bounded)** — anything that talks to the outside world: balance
   reconciliation and sanctions lookups against your [connectors](./connectors.md), and the
   cross-model [second opinion](./policy-packs.md). Bounded by `SENTINEL_SLOW_BUDGET_MS`.

The verdicts aggregate with precedence **BLOCK > ESCALATE > ALLOW** — the highest-precedence verdict
any check returns wins. If the fast tier already yields BLOCK, the slow tier is **skipped** (no wasted
model spend or network calls).

## Fail-safe by construction

Sentinel is designed so that *uncertainty never becomes a silent ALLOW*:

- A slow check that misses its deadline → **ESCALATE**.
- A ground-truth source that can't give a confident answer (`undefined` / `unknown`) → **ESCALATE**.
- A policy that resolves to **no** checks → **ESCALATE** (never an empty-ALLOW).
- An **unknown** policy id → **HTTP 400** (since v1.0.2; previously surfaced as a 500). Fail-closed:
  no checks run, so nothing can be ALLOWed.
- The independent model can only push toward caution: **agree → ALLOW, disagree → ESCALATE** — it can
  never *originate* a BLOCK (hard blocks come from deterministic rules) and never relax a stricter
  verdict.
- The SDK **fails closed** (BLOCK) when the sidecar is unreachable or returns a malformed decision.

## What it is — and isn't

- It **is** an independent, fail-safe verification layer with a signed, tamper-evident audit trail.
- It **is not** an authentication gateway. The `/v1/*` API is unauthenticated by design and binds
  loopback by default — run it inside your trust boundary, behind your own authn / mTLS / network
  policy. See the [security model](./security.md).

## Where to go next

- [Getting started](./getting-started.md) — zero to a gated action in ~10 minutes.
- [Policy packs & the rule DSL](./policy-packs.md) — the built-in packs and how to write your own.
- [Provenance & audit](./provenance.md) — the signed record format and how verification works.
- [The adjudication protocol](./adjudication-protocol.md) — the optional, stronger guarantee
  (execution-bound, single-use authorization receipts).
