# Provenance & audit

Every decision Sentinel makes — ALLOW, BLOCK, or ESCALATE, plus every human approve/deny — is written
as an **append-only, hash-chained, Ed25519-signed** record. Together they form a tamper-evident audit
trail you can verify end to end, offline, with nothing but the records and a public key.

## The record

```jsonc
{
  "id":              "rec_…",          // unique record id
  "seq":             42,                // monotonic sequence (position in the chain)
  "ts":              "2026-06-22T…Z",   // ISO-8601 timestamp
  "prevHash":        "…",               // contentHash of seq-1 (genesis: a fixed seed)
  "contentHash":     "…",               // SHA-256 over the canonical record body
  "keyId":           "ed25519:<64-hex>",// FULL SHA-256 of the signer public key
  "signerPublicKey": "<base64>",        // the key, bound into the signed body
  "sig":             "<base64>",        // Ed25519 signature over contentHash
  "tenant":          "acme",            // optional
  "action":          { "id","type","payload","meta?" },
  "actionFingerprint": "…",             // stable digest of the action
  "context":         { "runId","actor?","provider?","model?","tenant?","trace?" },
  "checks":          [ { "check","outcome","verdict","reason?","details?","latencyMs?" } ],
  "verdict":         "ESCALATE",
  "reason":          "…",
  "escalationId":    "esc_…"            // when escalated
}
```

Human decisions (approve/deny) append a linked record too, so "who approved this, and when" is part of
the same chain as the original gate decision.

## How the chain is built

1. The record body is serialized with **canonical JSON** (stable key order, deterministic number /
   bigint encoding) so the same logical content always hashes identically.
2. `contentHash = SHA-256(canonical body)`, where the body includes `prevHash` and the
   `signerPublicKey`. This links each record to its predecessor and binds the signing key to the
   content.
3. The record is signed: `sig = Ed25519(contentHash)`.
4. `keyId` is the **full** SHA-256 of the public key (64 hex chars) — not truncated — so a `keyId`
   can't be collided onto a different key.

## How verification works (`GET /v1/verify`)

For each record, in order, the verifier:

1. Re-derives `keyId` from the embedded `signerPublicKey` and checks it matches (and is a trusted key).
2. Recomputes `contentHash` from the canonical body and checks it matches — **before** touching the
   signature, so any field mutation fails closed even though the signature is over the hash.
3. Checks `prevHash` links to the previous record's `contentHash` (no insert/delete/reorder).
4. Verifies the Ed25519 signature.

Any tamper — edit a field, drop a record, splice one in, re-sign with the wrong key — is detected.

```bash
curl localhost:4000/v1/verify
# { "ok": true }                          ← intact
# { "ok": false, "brokenAt": 17, "reason": "contentHash mismatch" }   ← tampered at seq 17
```

`sentinel verify [url]` wraps this and exits non-zero on failure — drop it in CI or a cron integrity
check.

## Durability & concurrency

See **[persistence & storage](./persistence.md)** for the full backend matrix, schema, backups, and
retention. In brief:

- **Stores:** `memory` (dev, non-durable), `sqlite:` (durable single-node, no server), `postgres://`
  (durable, multi-writer / HA). The sidecar resumes the chain from the persisted tail after a restart.
- **Within a process:** the append critical section is serialized, so concurrent guards still produce
  one linear chain.
- **Across processes (HA):** several sidecars can share one Postgres. A unique-sequence constraint plus
  optimistic retry (`SENTINEL_APPEND_RETRIES`, default 12) guarantees a single, fork-free chain even
  under heavy concurrent writes. *(Validated in this project's load tests — thousands of concurrent
  appends produced one chain that verifies `ok:true`.)*

## Querying & exporting

| Endpoint | Use |
|---|---|
| `GET /v1/records` | query the log (filters: `verdict`, `tenant`, `runId`, `since`, `until`, `limit`, `offset`) |
| `GET /v1/records/:id` | one record |
| `GET /v1/analytics` | allow/block/escalate rates, by action type / tenant, top reasons |
| `GET /v1/export` | export signed records (same filters) to feed a GRC / control-plane pipeline |
| `GET /v1/verify` | verify the whole chain |

See the full [HTTP API reference](./api-reference.md). To aggregate across many sidecars/tenants
(dashboards, signed-bundle distribution, OTLP, GRC export), feed `/v1/export` into the separate
control-plane project or your own evidence pipeline.

## Why this matters

The signed chain is the artifact an auditor, regulator, or incident responder actually wants: a
complete, ordered, tamper-evident record of *what the agent tried to do, what the gate decided, on what
evidence, and who signed off* — independent of the agent, and verifiable without trusting Sentinel at
runtime.
