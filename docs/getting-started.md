# Getting started

A 10-minute path from zero to a gated AI action with a signed audit record — using both SDKs.

## 0. Prerequisites
- Node.js ≥ 20 (for the sidecar and the TS SDK)
- Python ≥ 3.9 (only if you use the Python SDK)
- No API keys or database needed for this walkthrough (we use the `mock` second-opinion provider and the in-memory store).

## 1. Run the sidecar
```bash
cd sentinel
npm install
SENTINEL_SECOND_OPINION_PROVIDER=mock SENTINEL_DATABASE_URL=memory npm run sidecar
# → Sentinel sidecar listening on :4000 (signer ed25519:…, provider mock)
```
Verify it's up:
```bash
curl localhost:4000/healthz                 # {"status":"ok"}
```

## 2. Guard an action from TypeScript
```bash
npm install @montanalabs/sentinel-sdk      # zero-dependency client
```
```ts
import { SentinelClient, Action } from '@montanalabs/sentinel-sdk';

const sentinel = new SentinelClient({ endpoint: 'http://localhost:4000' });

async function payVendor(amount: number, to: string) {
  const action = Action.payment({ amount, from: 'acct_ops', to });
  const decision = await sentinel.guard(action, { runId: 'demo-1' }, 'fintech.payments');

  if (SentinelClient.allowed(decision)) {
    // ... actually move the money here ...
    console.log('ALLOWED', decision.recordId);
  } else {
    console.log(decision.verdict, '-', decision.reason);
  }
}

await payVendor(200, 'vendor_42');        // ALLOWED
await payVendor(100, 'acct_evil');        // BLOCK – counterparty is sanctioned (ledger)*
```
\* The default demo ledger marks `acct_evil`/`acct_ofac_1` sanctioned. See [connectors](./connectors.md).

## 3. Guard an action from Python
```bash
pip install sentinel-guard                 # the Python SDK (once published)
```
```python
from sentinel_guard import SentinelClient, Action

sentinel = SentinelClient("http://localhost:4000")
d = sentinel.guard(Action.payment({"amount": 200, "from": "acct_ops", "to": "vendor_42"}),
                   {"runId": "demo-1"}, "fintech.payments")
print(d.verdict, d.record_id)              # ALLOW rec_…
if d.allowed:
    ...                                    # move the money
```

## 4. Inspect the decisions
```bash
curl localhost:4000/v1/records | jq '.[].verdict'   # every gated action + its verdict
curl localhost:4000/v1/analytics | jq               # allow/block/escalate rates
```

## 5. Verify the audit chain
```bash
curl localhost:4000/v1/verify              # {"ok":true}
curl localhost:4000/v1/records | jq '.[0]' # a signed, hash-chained record
```
Tamper with any stored record and `/v1/verify` reports `ok:false` with the broken index.

## 6. Trigger and resolve an escalation
```bash
# A high-value transfer requires dual-control sign-off -> ESCALATE
curl -s localhost:4000/v1/guard -H 'content-type: application/json' -d '{
  "action":{"id":"a1","type":"payment","payload":{"amount":80000,"from":"acct_ops","to":"vendor_42"}},
  "context":{"runId":"demo-1"},"policy":"fintech.payments"}' | jq '{verdict,escalationId}'

# Approve it — appends a signed human.review record
ESC=$(curl -s 'localhost:4000/v1/escalations?status=pending' | jq -r '.[0].id')
curl -s localhost:4000/v1/escalations/$ESC/resolve -H 'content-type: application/json' \
  -d '{"decision":"approve","approver":"treasurer@acme.com"}' | jq
```

## 7. Turn on a real cross-model second opinion
```bash
ANTHROPIC_API_KEY=sk-ant-… SENTINEL_SECOND_OPINION_PROVIDER=anthropic npm run sidecar
```
Now the slow tier asks an independent Claude/GPT model whether each action is safe; disagreement → ESCALATE. (Raise `SENTINEL_SLOW_BUDGET_MS` for real model latency.)

## Next
- [Policy packs & the rule DSL](./policy-packs.md) — built-in packs and writing your own
- [HTTP API reference](./api-reference.md)
- [Connectors](./connectors.md) — reconcile against your own systems of record
- [Self-hosting & operations](./self-hosting.md)
- SDKs: TypeScript (`@montanalabs/sentinel-sdk` on npm) · Python (`sentinel-guard` on PyPI)
