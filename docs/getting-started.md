# Getting started

A 10-minute path from zero to a gated AI action with a signed audit record — in TypeScript, Python, or plain curl.

## 0. Prerequisites

No API keys and no database — this walkthrough uses the offline `mock` second-opinion provider and the in-memory store. (Node ≥ 22.5 is only needed to run *from source*; the binary and Docker image bundle their own runtime. Python ≥ 3.9 only for the Python SDK.)

## 1. Install and run the sidecar

Pick one. Each starts the gate on `http://localhost:4000` with the offline `mock` provider and an in-memory store — no keys, no database.

::::tabs
:::tab{title="CLI"}
```bash
# install the standalone binary (macOS / Linux)
curl -fsSL https://montanalabs.ai/sentinel/install.sh | sh

# run the gate
SENTINEL_SECOND_OPINION_PROVIDER=mock SENTINEL_DATABASE_URL=memory sentinel start
```
:::
:::tab{title="Docker"}
```bash
docker run -p 4000:4000 \
  -e SENTINEL_SECOND_OPINION_PROVIDER=mock \
  -e SENTINEL_DATABASE_URL=memory \
  ghcr.io/montanalabs/sentinel:latest
```
:::
:::tab{title="From source"}
```bash
git clone https://github.com/montanalabs/sentinel && cd sentinel
npm install
SENTINEL_SECOND_OPINION_PROVIDER=mock SENTINEL_DATABASE_URL=memory npm run sidecar
```
:::
::::

Verify it's up:
```bash
curl localhost:4000/healthz      # {"status":"ok"}
```

## 2. Guard an action

Call the gate from your agent at the moment it is about to act — install the thin client, then `guard()`:

::::tabs
:::tab{title="TypeScript"}
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
await payVendor(100, 'acct_ofac_1');      // BLOCK – sanctioned counterparty
```
:::
:::tab{title="Python"}
```python
from sentinel_guard import SentinelClient, Action

sentinel = SentinelClient("http://localhost:4000")
d = sentinel.guard(Action.payment({"amount": 200, "from": "acct_ops", "to": "vendor_42"}),
                   {"runId": "demo-1"}, "fintech.payments")
print(d.verdict, d.record_id)              # ALLOW rec_…
if d.allowed:
    ...                                    # move the money
```
:::
:::tab{title="cURL"}
```bash
curl -s localhost:4000/v1/guard -H 'content-type: application/json' -d '{
  "action":{"id":"a1","type":"payment","payload":{"amount":200,"from":"acct_ops","to":"vendor_42"}},
  "context":{"runId":"demo-1"},"policy":"fintech.payments"}' | jq '{verdict,recordId}'
```
:::
::::

The demo ledger funds `acct_ops` / `acct_treasury` and marks `acct_ofac_1` sanctioned. See [connectors](./connectors.md).

## 3. Inspect the decisions
```bash
curl localhost:4000/v1/records | jq '.[].verdict'   # every gated action + its verdict
curl localhost:4000/v1/analytics | jq               # allow/block/escalate rates
```

## 4. Verify the audit chain
```bash
curl localhost:4000/v1/verify              # {"ok":true}
curl localhost:4000/v1/records | jq '.[0]' # a signed, hash-chained record
```
Tamper with any stored record and `/v1/verify` reports `ok:false` with the broken index.

## 5. Trigger and resolve an escalation
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

## 6. Turn on a real cross-model second opinion
Restart the sidecar with a real provider and key:
```bash
SENTINEL_SECOND_OPINION_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-… sentinel start
```
The slow tier now asks an independent Claude / GPT model whether each action is safe; disagreement → ESCALATE. (Raise `SENTINEL_SLOW_BUDGET_MS` for real-model latency.)

## Next
- [Policy packs & the rule DSL](./policy-packs.md) — built-in packs and writing your own
- [HTTP API reference](./api-reference.md)
- [Connectors](./connectors.md) — reconcile against your own systems of record
- [Self-hosting & operations](./self-hosting.md)
- SDKs: TypeScript (`@montanalabs/sentinel-sdk` on npm) · Python (`sentinel-guard` on PyPI)
