# Frameworks & providers

Sentinel gates at the **action boundary** — the moment your agent is about to do something
consequential, it calls `guard()` and gets back `ALLOW` / `BLOCK` / `ESCALATE` *before* anything
executes. That's a single call ([SDK](./sdk.md) or [`POST /v1/guard`](./api-reference.md)), so
Sentinel is **agnostic to your agent framework and to the provider that performs the action** —
OpenAI, Anthropic, Vercel AI SDK, LangChain/LangGraph, Coinbase, Stripe, anything.

> The Sentinel pieces below (`SentinelClient`, `Action`, `guard`) are exact and covered by tests.
> The provider snippets use each SDK's **current** API — pin to the versions you install; their
> surfaces drift, but the integration point never does: **build the action → guard it → execute
> only on `ALLOW`.**

## The pattern

Every recipe is the same three steps:

1. **Describe** the proposed action as a Sentinel [`Action`](./sdk.md).
2. **`guard()`** it against a policy.
3. **Execute only on `ALLOW`** — route `ESCALATE` to human review, never execute on `BLOCK`. If the
   gate is unreachable the SDK [fails closed](./sdk.md) (BLOCK), so a missing verdict is never a yes.

```ts
import { SentinelClient, Action, type AgentContext } from '@montanalabs/sentinel';

const sentinel = new SentinelClient({ endpoint: process.env.SENTINEL_URL! });

class Blocked extends Error {}
class NeedsApproval extends Error {
  constructor(public escalationId?: string) { super('escalate'); }
}

/** Run `execute` only if the gate allows the action; otherwise throw. */
export async function guarded<T>(
  action: Action,
  context: AgentContext,
  policy: string,
  execute: () => Promise<T>,
): Promise<T> {
  const decision = await sentinel.guard(action, context, policy);
  if (SentinelClient.allowed(decision)) return execute();            // ALLOW → do it
  if (decision.verdict === 'ESCALATE') throw new NeedsApproval(decision.escalationId);
  throw new Blocked(decision.reason);                                 // BLOCK / fail-closed
}
```

## Agent frameworks — gate the tool, not the model

You don't gate the model; you gate the **tool that has side effects**. Put `guard()` inside the
tool's executor and the model even *sees* a refusal it can react to. Each framework names the schema
field differently — pick your vendor:

::::tabs
:::tab{title="Vercel AI SDK"}
`tool()` uses **`inputSchema`** (AI SDK v5+; it was `parameters` in v4).

```ts
import { tool } from 'ai';
import { z } from 'zod';
import { SentinelClient, Action } from '@montanalabs/sentinel';

const sendPayment = tool({
  description: 'Send a payment to a vendor',
  inputSchema: z.object({ amount: z.number(), to: z.string() }),
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
:::tab{title="OpenAI Agents SDK"}
`tool()` from `@openai/agents` requires a **`name`** and uses **`parameters`** (Zod).

```ts
import { tool } from '@openai/agents';
import { z } from 'zod';
import { SentinelClient, Action } from '@montanalabs/sentinel';

const sendPayment = tool({
  name: 'send_payment',
  description: 'Send a payment to a vendor',
  parameters: z.object({ amount: z.number(), to: z.string() }),
  async execute({ amount, to }) {
    const decision = await sentinel.guard(
      Action.payment({ amount, from: 'acct_treasury', to }), { runId }, 'fintech.payments',
    );
    if (!SentinelClient.allowed(decision)) return `${decision.verdict}: ${decision.reason}`;
    return provider.pay({ amount, to });
  },
});
```
:::
:::tab{title="Anthropic Claude"}
Define tools with **`input_schema`**; gate inside the loop that dispatches `tool_use` blocks.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { SentinelClient, Action } from '@montanalabs/sentinel';

const tools = [{
  name: 'send_payment',
  description: 'Send a payment to a vendor',
  input_schema: { type: 'object', properties: { amount: { type: 'number' }, to: { type: 'string' } }, required: ['amount', 'to'] },
}];

// when a response contains a tool_use block, gate before executing it
async function runTool(block) {
  if (block.name !== 'send_payment') return;
  const { amount, to } = block.input;
  const decision = await sentinel.guard(
    Action.payment({ amount, from: 'acct_treasury', to }), { runId }, 'fintech.payments',
  );
  const content = SentinelClient.allowed(decision)
    ? await provider.pay({ amount, to })
    : `refused (${decision.verdict}): ${decision.reason}`;   // returned as the tool_result
  return { type: 'tool_result', tool_use_id: block.id, content: String(content) };
}
```
:::
:::tab{title="LangChain / LangGraph"}
A `@tool` works the same in a LangChain agent or a LangGraph `create_react_agent`.

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

## Payments & onchain — gate the provider call

For SDKs that *execute* value transfer directly, wrap the call in the [`guarded()`](#the-pattern)
helper above:

::::tabs
:::tab{title="Coinbase CDP"}
Gate a wallet transfer (`@coinbase/cdp-sdk`) so a hijacked key or hallucinated transfer can't move
funds on its own:

```ts
import { CdpClient } from '@coinbase/cdp-sdk';
import { Action } from '@montanalabs/sentinel';

const cdp = new CdpClient();
const account = await cdp.evm.getOrCreateAccount({ name: 'treasury' });

await guarded(
  Action.payment({ amount, from: account.address, to: destination, currency: 'USDC' }),
  { runId, actor: { id: agentId } },
  'crypto.transfers',
  () => account.transfer({ to: destination, amount, token: 'usdc', network: 'base-sepolia' }),
);
```

A `crypto.transfers` policy can enforce per-tx and rolling daily caps, allow/deny lists, and
dual-control sign-off above a threshold — verified independently of the agent, with a signed record
of every decision.

> Using **Coinbase AgentKit** (`@coinbase/agentkit`)? Its actions are wired into your framework as
> tools — gate them with the **Agent frameworks** recipe above (wrap the transfer action's
> executor), rather than exposing the raw write tool.
:::
:::tab{title="Coinbase x402"}
[x402](https://github.com/coinbase/x402) settles a payment in response to an HTTP `402`. Probe the
price, gate it, then let the payment-enabled fetch settle only on `ALLOW`:

```ts
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { SentinelClient, Action } from '@montanalabs/sentinel';

const client = new x402Client();
registerExactEvmScheme(client, { signer });          // signer = viem account
const payFetch = wrapFetchWithPayment(fetch, client);

const probe = await fetch(resourceUrl);              // unpaid request → 402 with requirements
if (probe.status === 402) {
  const { maxAmountRequired, asset, payTo } = readPaymentRequirements(probe);  // from the 402 body
  const decision = await sentinel.guard(
    Action.payment({ amount: Number(maxAmountRequired), from: signer.address, to: payTo, currency: asset }),
    { runId }, 'crypto.x402',
  );
  if (!SentinelClient.allowed(decision)) throw new Error(`payment blocked: ${decision.reason}`);
}
const res = await payFetch(resourceUrl);             // ALLOW → x402 signs, settles, returns the resource
```
:::
:::tab{title="Stripe"}
Gate the sensitive call directly with the [`guarded()`](#the-pattern) helper:

```ts
import Stripe from 'stripe';
import { Action } from '@montanalabs/sentinel';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

await guarded(
  Action.of('payment.refund', { chargeId, amount, currency: 'usd' }),
  { runId, actor }, 'fintech.refunds',
  () => stripe.refunds.create({ charge: chargeId, amount }),
);
```

> The [Stripe Agent Toolkit](https://github.com/stripe/agent-toolkit) (`@stripe/agent-toolkit`)
> exposes Stripe operations to agents as tools via `.getTools()`. For write actions (refunds,
> payouts, subscriptions), gate them with the **Agent frameworks** recipe above instead of exposing
> the raw tool.
:::
::::

## Where it fits any stack

| Stack | Gate at | Schema field |
| --- | --- | --- |
| Vercel AI SDK | inside the tool's `execute` | `inputSchema` |
| OpenAI Agents SDK | inside the tool's `execute` | `parameters` (+ `name`) |
| Anthropic Claude | in the `tool_use` dispatcher | `input_schema` |
| LangChain · LangGraph · CrewAI | inside the `@tool` body | — |
| Coinbase CDP wallet | before `account.transfer` | — |
| Coinbase AgentKit | wrap the action's executor (tool) | — |
| Coinbase x402 | before the `402` settles | — |
| Stripe (Agent Toolkit / raw SDK) | before `refunds` / `payouts` / `charges` | — |
| Anything else | wherever the irreversible call is made | — |

The rule is always the same: **guard the action, then execute only on `ALLOW`.** Define what each
policy enforces in [policy packs](./policy-packs.md); the full client API is in the
[SDK reference](./sdk.md).
