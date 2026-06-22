# SDK reference

The SDK is a thin client your agent calls at the action boundary. It submits the proposed action to
the sidecar and returns the verdict. **It never makes the decision** — the sidecar renders and signs
it. The client's job is to call safely and **fail closed** when the sidecar can't be trusted.

> Distribution note: the SDKs are published separately (TypeScript `@montanalabs/sentinel-sdk`,
> Python `sentinel-guard`). Until a package is on your registry, you can vendor the client from the
> `sentinel-sdks/` source — it has no third-party dependencies.

## Construct a client

::::tabs
:::tab{title="TypeScript"}
```ts
import { SentinelClient, Action } from '@montanalabs/sentinel-sdk';

const sentinel = new SentinelClient({
  endpoint: 'http://localhost:4000',    // required — sidecar base URL
  failMode: 'closed',                   // 'closed' (default) → BLOCK on transport failure; 'open' → ALLOW
  timeoutMs: 5000,                      // whole-request deadline (headers + body); default 5000
  headers: { 'x-internal-token': '…' }, // optional, sent on every request (e.g. for your gateway)
  // fetchImpl: customFetch,            // optional — inject a custom fetch (tests / proxies)
});
```
:::
:::tab{title="Python"}
```python
from sentinel_guard import SentinelClient, Action

sentinel = SentinelClient(
    "http://localhost:4000",            # required — sidecar base URL
    fail_mode="closed",                 # "closed" (default) → BLOCK on transport failure; "open" → ALLOW
    timeout_s=5,                        # whole-request deadline; default 5
    headers={"x-internal-token": "…"},  # optional, sent on every request
)
```
:::
::::

## Guard an action

::::tabs
:::tab{title="TypeScript"}
```ts
const action = Action.payment({ amount: 200, from: 'acct_ops', to: 'vendor_42' });
const decision = await sentinel.guard(action, { runId: 'run-1', actor: { id: 'agent', roles: ['ops'] } }, 'fintech.payments');

if (SentinelClient.allowed(decision)) {
  // ALLOW — and only ALLOW — reaches here. Safe to execute.
  await moveMoney(action);
} else if (decision.verdict === 'ESCALATE') {
  await routeToHuman(decision.escalationId);   // present on every ESCALATE
} else {
  console.warn('blocked:', decision.reason);
}
```
:::
:::tab{title="Python"}
```python
action = Action.payment({"amount": 200, "from": "acct_ops", "to": "vendor_42"})
decision = sentinel.guard(action, {"runId": "run-1", "actor": {"id": "agent", "roles": ["ops"]}}, "fintech.payments")

if decision.allowed:                          # True only when verdict == "ALLOW"
    move_money(action)
elif decision.verdict == "ESCALATE":
    route_to_human(decision.escalation_id)    # present on every ESCALATE
else:
    print("blocked:", decision.reason)
```
:::
::::

The allowed check is null-safe — `SentinelClient.allowed(d)` (TS) and `decision.allowed` (Python) return `true` **only** when the verdict is exactly `ALLOW`, so a missing or garbled decision can never be coerced into a green light.

## Build an action

::::tabs
:::tab{title="TypeScript"}
```ts
Action.payment({ amount, from, to, currency?, memo? }); // type = 'payment'
Action.of('record_update', { patientId, field, value }); // any custom type
// both accept opts: { id?, meta? }  (id defaults to `act_<uuid>`)
```
:::
:::tab{title="Python"}
```python
Action.payment({"amount": ..., "from": ..., "to": ...})              # type = "payment"
Action.of("record_update", {"patientId": ..., "field": ..., "value": ...})  # any type
# both accept opts: id=..., meta=...  (id defaults to "act_<uuid>")
```
:::
::::

## The decision

::::tabs
:::tab{title="TypeScript"}
```ts
type Verdict = 'ALLOW' | 'BLOCK' | 'ESCALATE';

interface GuardDecision {
  verdict: Verdict;
  recordId: string;       // id of the signed provenance record
  checks: CheckResult[];  // per-check breakdown
  reason?: string;
  escalationId?: string;  // present iff verdict === 'ESCALATE'
}
```
:::
:::tab{title="Python"}
```python
# guard(...) returns a GuardDecision:
#   verdict: "ALLOW" | "BLOCK" | "ESCALATE"
#   record_id: str             # id of the signed provenance record
#   checks: list[CheckResult]  # per-check breakdown
#   reason: str | None
#   escalation_id: str | None  # set iff verdict == "ESCALATE"
#   allowed: bool              # True only when verdict == "ALLOW"
```
:::
::::

## Fail-safe behaviour

The client treats anything it can't verify as a transport failure and resolves per `failMode`
(default **closed → BLOCK**). This covers:

- the sidecar unreachable, or the request exceeding the timeout;
- a non-2xx response (e.g. a `400` for an unknown policy);
- a 2xx body that **isn't a well-formed decision** — including an `ESCALATE` missing its
  `escalationId`. A buggy / stale / hostile responder therefore can't return `{verdict:'ALLOW'}` and be
  honoured.

A transport-fallback decision has an **empty `recordId`** and a single synthetic check
(`sentinel.transport`), so you can distinguish a real gate decision from a client-side fail-closed.

::::tabs
:::tab{title="TypeScript"}
```ts
// fail OPEN only where an outage must not halt the business and the risk is acceptable:
const soft = new SentinelClient({ endpoint, failMode: 'open' }); // transport failure → ALLOW
```
:::
:::tab{title="Python"}
```python
# fail OPEN only where an outage must not halt the business and the risk is acceptable:
soft = SentinelClient(endpoint, fail_mode="open")  # transport failure → ALLOW
```
:::
::::

## Without an SDK (raw HTTP)

The SDK is a convenience; any HTTP client works. `POST /v1/guard` with `{ action, context, policy }`
and read `verdict` / `recordId`. See the [HTTP API](./api-reference.md). If you roll your own,
replicate the fail-closed rule: **treat any non-2xx or malformed body as BLOCK.**
