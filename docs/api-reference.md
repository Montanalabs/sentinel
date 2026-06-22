# HTTP API reference

The self-hosted sidecar. Base URL defaults to `http://localhost:4000`. JSON in/out.

**Auth:** the OSS sidecar is designed to run inside your trust boundary (sidecar/localhost or private network) and has **no built-in API auth** — put it behind your own network policy / mTLS, or front it with the separate control-plane project, which adds org auth. Optional `SENTINEL_RATE_LIMIT_*` / `SENTINEL_MAX_CONCURRENT` apply to `/v1/*`.

## Core types
```ts
type Verdict = 'ALLOW' | 'BLOCK' | 'ESCALATE';

interface Action {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

interface AgentContext {
  runId: string;
  provider?: string;
  model?: string;
  actor?: { id: string; roles?: string[] };
  tenant?: string;
  trace?: unknown[];
}

interface CheckResult {
  check: string;
  outcome: 'pass' | 'fail' | 'inconclusive';
  verdict: Verdict;
  reason?: string;
  details?: Record<string, unknown>;
  latencyMs?: number;
}

interface GuardDecision {
  verdict: Verdict;
  recordId: string;
  checks: CheckResult[];
  reason?: string;
  escalationId?: string; // present when verdict === 'ESCALATE'
}

interface ProvenanceRecord {
  id: string;
  ts: string;
  seq: number;
  prevHash: string;
  contentHash: string;
  keyId: string;
  signerPublicKey: string;
  sig: string;
  tenant?: string;
  action: Action;
  actionFingerprint: string;
  context: AgentContext;
  checks: CheckResult[];
  verdict: Verdict;
  reason?: string;
  escalationId?: string;
}
```

---

## `GET /healthz`
Liveness — the process is up. Does not touch the store.
**Returns:** `200`
```ts
{ status: 'ok' }
```

## `GET /readyz`
Readiness — verifies the provenance store is reachable. Wire it to your load-balancer / k8s readiness probe.
**Returns:** `200`
```ts
{ status: 'ready' }
```
**Errors:** `503` — store unavailable.

## `POST /v1/guard`
Gate a single action.
**Request body:**
```ts
{ action: Action; context: AgentContext; policy: string }
```
**Returns:** `200` — `GuardDecision` (carries `escalationId` when the verdict is `ESCALATE`).
**Errors:** `400` — invalid body (Zod issues in `details`); `404` — unknown policy.

```bash
curl localhost:4000/v1/guard -H 'content-type: application/json' -d '{
  "action":  { "id": "a1", "type": "payment", "payload": { "amount": 42000, "from": "acct_ops", "to": "vendor_42" } },
  "context": { "runId": "run_1", "provider": "anthropic" },
  "policy":  "fintech.payments"
}'
```

## `POST /v1/guard/batch`
Gate a multi-agent fan-out as one linked chain.
**Request body:**
```ts
{ requests: Array<{ action: Action; context: AgentContext; policy: string }> }  // max 256
```
**Returns:** `200`
```ts
{ decisions: GuardDecision[] }
```

## `GET /v1/records`
Query the provenance log, ordered by sequence.
**Query:** `verdict`, `tenant`, `runId`, `since` (ISO, inclusive), `until` (ISO, exclusive), `limit`, `offset`.
**Returns:** `200` — `ProvenanceRecord[]`

## `GET /v1/records/:id`
Fetch one provenance record by id.
**Returns:** `200` — `ProvenanceRecord`
**Errors:** `404` — not found.

## `GET /v1/verify`
Verify the entire hash-chain.
**Returns:** `200`
```ts
{ ok: true } | { ok: false; brokenAt: number; reason: string }
```

## `GET /v1/analytics`
Decision analytics aggregated over the store.
**Returns:** `200`
```ts
{
  total: number;
  byVerdict: { ALLOW: number; BLOCK: number; ESCALATE: number };
  allowRate: number; blockRate: number; escalateRate: number;
  byActionType: Record<string, number>;
  byTenant: Record<string, number>;
  topReasons: { reason: string; count: number }[];
}
```

## `GET /v1/export`
Export signed records (to feed a GRC platform / control plane). Accepts the same **Query** filters as `/v1/records`.
**Returns:** `200`
```ts
{ format: 'json'; count: number; records: ProvenanceRecord[] }
```

## `GET /v1/escalations`
List the human-review queue.
**Query:** `status` = `pending | approved | denied` (omit for all).
**Returns:** `200` — `Escalation[]`
```ts
interface Escalation {
  id: string;
  recordId: string;
  action: Action;
  approvers: string[];
  reason?: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
}
```

## `POST /v1/escalations/:id/resolve`
Record a human decision; appends a signed `human.review` record (ALLOW if approved, BLOCK if denied), keeping the chain valid.
**Request body:**
```ts
{ decision: 'approve' | 'deny'; approver: string }
```
**Returns:** `200`
```ts
{ escalation: Escalation; recordId: string }
```
**Errors:** `403` — approver not on the allowlist; `404` — unknown id; `409` — already resolved.

---

## Adjudication protocol

Additive routes, registered only when `SENTINEL_PROTOCOL_ENABLED=1` (the core routes above are unchanged). They turn an `ALLOW` into a signed, single-use **authorization receipt** and let an executor validate and audit it. See [adjudication-protocol.md](./adjudication-protocol.md).

### `POST /v1/adjudications`
Run the adjudicator; on `ALLOW` it issues, persists, and returns a receipt.
**Request body:**
```ts
{
  guard: { action: Action; context: AgentContext; policy: string };
  action: CanonicalAction;
  contextDigest: Hex64;
  policy: PolicyManifest;
  evidence: EvidenceItem[];
  model?: { verdict: Verdict; confidence?: number };
  independence?: IndependenceProfile;
  humanApprovalReference?: string;
  receiptTtlMs?: number;
  maxExecutions?: number;
}
```
**Returns:** `200` —
```ts
{
  finalVerdict: Verdict;
  adjudication: AdjudicationResult;
  policy: PolicyManifest;
  evidence: EvidenceItem[];
  independenceWarnings: string[];
  recordId: string;
  receipt?: AuthorizationReceipt;   // present iff finalVerdict === 'ALLOW'
}
```
**Errors:** `400` — invalid body / non-canonical action.

### `POST /v1/receipts/validate`
Validate a receipt against an execution binding (consumes its single-use nonce on success).
**Request body:**
```ts
{
  receipt: AuthorizationReceipt;
  binding: {
    actionDigest: Hex64;
    contextDigest: Hex64;
    expectedPolicyBundleDigest?: Hex64;
    requireHumanApproval?: boolean;
  };
}
```
**Returns:** `200` — a validation *result* (not a transport error):
```ts
{ ok: true; executionCount: number } | { ok: false; error: { code: string; message: string } }
```

### `POST /v1/executions`
Ingest a signed execution receipt into the audit log.
**Request body:** `ExecutionReceipt`
**Returns:** `200`
```ts
{ stored: true; executionId: string }
```
**Errors:** `400` — untrusted or invalid executor signature.

### `POST /v1/receipts/revoke`
Revoke a receipt id (it then fails closed at the next validation).
**Request body:**
```ts
{ receiptId: string; reason?: string }
```
**Returns:** `200`
```ts
{ revoked: true; receiptId: string }
```

### `GET /v1/audit/verify`
Complete-mediation audit over persisted authorization + execution receipts.
**Returns:** `200` —
```ts
{
  valid: boolean;
  executionsChecked: number;
  violations: { type: string; executionId?: string; authorizationReceiptId?: string; detail: string }[];
  coverage: number;
}
```

### `GET /v1/audit/coverage`
Lightweight coverage summary (no per-violation detail).
**Returns:** `200`
```ts
{ valid: boolean; executionsChecked: number; coverage: number }
```

---

## Status codes
`200` ok · `400` invalid body **or unknown policy** (`{"error":"unknown policy pack: <id>"}`, since v1.0.2 — previously a 500) · `404` not found · `409` already resolved · `403` approver not on the escalation's allowlist · `429` rate-limited (if configured) · `503` store unavailable (`/readyz`) or overloaded (if `SENTINEL_MAX_CONCURRENT` exceeded). The sidecar never leaks internal exception detail — unexpected errors return a generic `500 {"error":"internal error"}`.

## Verdict semantics
- **ALLOW** — proceed. **BLOCK** — do not execute; `reason` explains why. **ESCALATE** — hold for human review; an `escalationId` is created and resolvable via the escalations API.
