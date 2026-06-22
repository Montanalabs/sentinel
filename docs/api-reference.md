# HTTP API reference

The self-hosted sidecar. Base URL defaults to `http://localhost:4000`. JSON in/out.

**Auth:** the OSS sidecar is designed to run inside your trust boundary (sidecar/localhost or private network) and has **no built-in API auth** — put it behind your own network policy / mTLS, or front it with the separate control-plane project, which adds org auth. Optional `SENTINEL_RATE_LIMIT_*` / `SENTINEL_MAX_CONCURRENT` apply to `/v1/*`.

## Core types
```ts
type Verdict = 'ALLOW' | 'BLOCK' | 'ESCALATE';

interface Action  { id: string; type: string; payload: Record<string, unknown>; meta?: Record<string, unknown>; }
interface AgentContext { runId: string; provider?: string; model?: string;
  actor?: { id: string; roles?: string[] }; tenant?: string; trace?: unknown[]; }
interface CheckResult { check: string; outcome: 'pass'|'fail'|'inconclusive'; verdict: Verdict;
  reason?: string; details?: Record<string, unknown>; latencyMs?: number; }
interface GuardDecision { verdict: Verdict; recordId: string; checks: CheckResult[]; reason?: string; escalationId?: string; }
interface ProvenanceRecord { id, ts, seq, prevHash, contentHash, keyId, signerPublicKey, sig,
  tenant?, action, actionFingerprint, context, checks, verdict, reason?, escalationId? }
```

---

## `GET /healthz`
Liveness (process up; does not touch the store). → `200 { "status": "ok" }`

## `GET /readyz`
Readiness — checks the provenance store is reachable. → `200 { "status": "ready" }` · **503** when the store is unavailable. Wire to your load balancer / k8s readiness probe.

## `POST /v1/guard`
Gate one action.
**Body:** `{ action: Action, context: AgentContext, policy: string }`
**200:** `GuardDecision` (includes `escalationId` when `verdict === 'ESCALATE'`).
**400:** invalid body (Zod issues in `details`).
```bash
curl localhost:4000/v1/guard -H 'content-type: application/json' -d '{
  "action":{"id":"a1","type":"payment","payload":{"amount":42000,"from":"acct_ops","to":"vendor_42"}},
  "context":{"runId":"run_1","provider":"anthropic"},
  "policy":"fintech.payments"}'
```

## `POST /v1/guard/batch`
Gate a multi-agent fan-out in one linked chain.
**Body:** `{ requests: Array<{ action, context, policy }> }` (max 256)
**200:** `{ decisions: GuardDecision[] }`

## `GET /v1/records`
Query provenance, ordered by sequence.
**Query:** `verdict`, `tenant`, `runId`, `since` (ISO, inclusive), `until` (ISO, exclusive), `limit`, `offset`.
**200:** `ProvenanceRecord[]`

## `GET /v1/records/:id`
**200:** `ProvenanceRecord` · **404:** not found.

## `GET /v1/verify`
Verify the whole hash-chain.
**200:** `{ ok: true }` or `{ ok: false, brokenAt: number, reason: string }`.

## `GET /v1/analytics`
Decision analytics over the store.
**200:** `{ total, byVerdict: {ALLOW,BLOCK,ESCALATE}, allowRate, blockRate, escalateRate, byActionType, byTenant, topReasons: [{reason,count}] }`

## `GET /v1/export`
Export records (to feed a GRC platform / control plane). Accepts the same filters as `/v1/records`.
**200:** `{ format: 'json', count, records: ProvenanceRecord[] }`

## `GET /v1/escalations`
**Query:** `status` = `pending | approved | denied` (omit for all).
**200:** `Escalation[]` — `{ id, recordId, action, approvers, reason?, status, createdAt, resolvedBy?, resolvedAt? }`

## `POST /v1/escalations/:id/resolve`
Record a human decision; appends a signed `human.review` provenance record (ALLOW if approved, BLOCK if denied), keeping the chain valid.
**Body:** `{ decision: 'approve' | 'deny', approver: string }`
**200:** `{ escalation, recordId }` · **404:** unknown id · **409:** already resolved.

---

## Adjudication protocol

Additive routes, registered only when `SENTINEL_PROTOCOL_ENABLED=1` (the core routes above are unchanged). They turn an `ALLOW` into a signed, single-use **authorization receipt** and let an executor validate and audit it. See [adjudication-protocol.md](./adjudication-protocol.md).

### `POST /v1/adjudications`
Run the adjudicator; on `ALLOW` it issues, persists, and returns a receipt.
**Body:** `{ guard: { action, context, policy }, action: CanonicalAction, contextDigest: hex64, policy: PolicyManifest, evidence: EvidenceItem[], model?: { verdict, confidence? }, independence?: …, humanApprovalReference?, receiptTtlMs?, maxExecutions? }`
**200:** `{ finalVerdict, adjudication, policy, evidence, independenceWarnings, recordId, receipt? }` (`receipt` present iff `finalVerdict === 'ALLOW'`). **400:** invalid body / non-canonical action.

### `POST /v1/receipts/validate`
Validate a receipt for an execution binding (consumes its single-use nonce on success).
**Body:** `{ receipt, binding: { actionDigest: hex64, contextDigest: hex64, expectedPolicyBundleDigest?, requireHumanApproval? } }`
**200:** `{ ok: true, executionCount }` or `{ ok: false, error: { code, message } }` (a validation *result*, not a transport error).

### `POST /v1/executions`
Ingest a signed execution receipt into the audit log (rejected if the executor signature is untrusted/invalid).
**Body:** `ExecutionReceipt` · **200:** `{ stored: true, executionId }` · **400:** untrusted/invalid signature.

### `POST /v1/receipts/revoke`
Revoke a receipt id (fails closed at the next validation).
**Body:** `{ receiptId: string, reason? }` · **200:** `{ revoked: true, receiptId }`

### `GET /v1/audit/verify`
Complete-mediation audit over persisted authorization + execution receipts.
**200:** `{ valid, executionsChecked, violations: [{ type, executionId?, authorizationReceiptId?, detail }], coverage }`

### `GET /v1/audit/coverage`
**200:** `{ valid, executionsChecked, coverage }`

---

## Status codes
`200` ok · `400` invalid body **or unknown policy** (`{"error":"unknown policy pack: <id>"}`, since v1.0.2 — previously a 500) · `404` not found · `409` already resolved · `403` approver not on the escalation's allowlist · `429` rate-limited (if configured) · `503` store unavailable (`/readyz`) or overloaded (if `SENTINEL_MAX_CONCURRENT` exceeded). The sidecar never leaks internal exception detail — unexpected errors return a generic `500 {"error":"internal error"}`.

## Verdict semantics
- **ALLOW** — proceed. **BLOCK** — do not execute; `reason` explains why. **ESCALATE** — hold for human review; an `escalationId` is created and resolvable via the escalations API.
