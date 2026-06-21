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
Liveness. → `200 { "status": "ok" }`

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

## Status codes
`200` ok · `400` invalid body · `404` not found · `409` already resolved · `429` rate-limited (if configured) · `503` overloaded (if `SENTINEL_MAX_CONCURRENT` exceeded).

## Verdict semantics
- **ALLOW** — proceed. **BLOCK** — do not execute; `reason` explains why. **ESCALATE** — hold for human review; an `escalationId` is created and resolvable via the escalations API.
