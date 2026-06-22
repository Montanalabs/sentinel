# Integrations & recipes

Sentinel gates at the **action boundary** — the moment your agent is about to do something
consequential, it calls `guard()` and gets back `ALLOW` / `BLOCK` / `ESCALATE` *before* anything
executes. Because that's a single call ([SDK](./sdk.md) or [`POST /v1/guard`](./api-reference.md)),
Sentinel is **agnostic to your agent framework and to the provider that ultimately performs the
action** — Coinbase, Stripe, a database, an email API, anything.

> The Sentinel pieces below (`SentinelClient`, `Action`, `guard`) are exact. The **provider**
> snippets are illustrative — check each provider's current SDK for the precise call. The
> integration point never changes: **build the action → guard it → execute only on `ALLOW`.**

## The pattern

Every recipe on this page is the same three steps:

1. **Describe** the proposed action as a Sentinel [`Action`](./sdk.md).
2. **`guard()`** it against a policy.
3. **Execute the provider call only on `ALLOW`** — route `ESCALATE` to human review, never execute
   on `BLOCK`. If the gate is unreachable the SDK [fails closed](./sdk.md) (BLOCK), so a missing
   verdict can never become a silent yes.

```ts
import { SentinelClient, Action } from '@montanalabs/sentinel';

const sentinel = new SentinelClient({ endpoint: process.env.SENTINEL_URL! });

/** Run `execute` only if the gate allows the action. */
async function guarded<T>(action, context, policy, execute: () => Promise<T>): Promise<T> {
  const decision = await sentinel.guard(action, context, policy);
  if (SentinelClient.allowed(decision)) return execute();            // ALLOW → do it
  if (decision.verdict === 'ESCALATE') throw new NeedsApproval(decision.escalationId);
  throw new Blocked(decision.reason);                                 // BLOCK
}
```

## Coinbase — AgentKit & CDP wallets

[Coinbase AgentKit](https://github.com/coinbase/agentkit) and the CDP Wallet SDK let an agent move
funds and act onchain. Put Sentinel in front of the wallet action, so a hijacked key, a prompt
injection, or a hallucinated transfer can't move money on its own:

```ts
// the agent proposes an onchain transfer — gate it before the wallet executes
const action = Action.payment({ amount: 5_000, from: wallet.id, to: destination, currency: 'USDC' });

const decision = await sentinel.guard(action, { runId, actor: { id: agentId } }, 'crypto.transfers');
if (!SentinelClient.allowed(decision)) {
  return handle(decision);   // BLOCK (sanctioned address, over daily cap) / ESCALATE (dual-control)
}

// only now does value move onchain
const transfer = await wallet.createTransfer({ amount: 5_000, assetId: 'usdc', destination });
await transfer.wait();
```

A `crypto.transfers` policy can enforce per-transaction and rolling daily caps, allow/deny lists,
and dual-control sign-off above a threshold — verified independently of the agent, with a signed
record of every decision. Because AgentKit exposes onchain *actions* to a framework (LangChain,
Vercel AI SDK, …), you can also gate inside the tool wrapper — see [Framework hooks](#framework-hooks--wrap-the-tool-not-the-agent).

## Coinbase x402 — agentic payments

[x402](https://github.com/coinbase/x402) lets an agent pay for an API or resource in response to an
HTTP `402 Payment Required`. Gate the payment **before** it settles, so the agent can't silently
drain a wallet paying for calls:

```ts
const res = await fetch(resourceUrl);
if (res.status === 402) {
  const { amount, asset, payTo } = parsePaymentRequirements(res);   // from the x402 challenge

  const decision = await sentinel.guard(
    Action.payment({ amount, from: account.address, to: payTo, currency: asset }),
    { runId },
    'crypto.x402',
  );
  if (!SentinelClient.allowed(decision)) throw new Error(`payment blocked: ${decision.reason}`);

  // ALLOW → settle the x402 payment and retry the request
  await settleAndRetry(res, account);
}
```

## Stripe — Agent Toolkit (fiat)

The [Stripe Agent Toolkit](https://github.com/stripe/agent-toolkit) exposes payment tools to agents.
Gate a refund, payout, or charge the same way:

```ts
const action = Action.of('payment.refund', { chargeId, amount, currency: 'usd' });

const decision = await sentinel.guard(action, { runId, actor }, 'fintech.refunds');
if (!SentinelClient.allowed(decision)) return handle(decision);

await stripe.refunds.create({ charge: chargeId, amount });
```

## Framework hooks — wrap the tool, not the agent

You don't gate the model; you gate the **tool that has side effects**. Drop `guard()` inside the
tool's executor and every framework benefits — the model even *sees* a refusal and can react to it.

::::tabs
:::tab{title="Vercel AI SDK"}
```ts
import { tool } from 'ai';
import { z } from 'zod';
import { SentinelClient, Action } from '@montanalabs/sentinel';

const sendPayment = tool({
  description: 'Send a payment to a vendor',
  inputSchema: z.object({ amount: z.number(), to: z.string() }), // AI SDK v5+ (was `parameters` in v4)
  execute: async ({ amount, to }) => {
    const decision = await sentinel.guard(
      Action.payment({ amount, from: 'acct_treasury', to }), { runId }, 'fintech.payments',
    );
    if (!SentinelClient.allowed(decision)) return { status: decision.verdict, reason: decision.reason };
    return provider.pay({ amount, to });
  },
});
```
:::
:::tab{title="LangChain (Python)"}
```python
import os
from langchain_core.tools import tool
from montanalabs_sentinel import SentinelClient, Action

sentinel = SentinelClient(os.environ["SENTINEL_URL"])

@tool
def send_payment(amount: float, to: str) -> str:
    """Send a payment to a vendor."""
    d = sentinel.guard(
        Action.payment({"amount": amount, "from": "acct_treasury", "to": to}),
        {"runId": run_id}, "fintech.payments",
    )
    if not d.allowed:
        return f"{d.verdict}: {d.reason}"   # the model sees the refusal and can adapt
    return pay(amount, to)
```
:::
::::

## Where it fits any stack

| Stack | Gate at |
| --- | --- |
| Coinbase AgentKit / CDP wallet | before `createTransfer` / the wallet action |
| Coinbase x402 | before the `402` payment settles |
| Stripe Agent Toolkit | before `charges` / `refunds` / `payouts` |
| Vercel AI SDK · LangChain · LangGraph · OpenAI Agents · MCP tools | inside the side-effecting tool's `execute` |
| Anything else | wherever the irreversible call is made |

The rule is always the same: **guard the action, then execute only on `ALLOW`.** Define what each
policy enforces in [policy packs](./policy-packs.md), and see the [SDK reference](./sdk.md) for the
full client API.
