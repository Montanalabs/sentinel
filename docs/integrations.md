# Integrations — overview

Sentinel gates at the **action boundary** — the moment your agent is about to do something
consequential, it calls `guard()` and gets back `ALLOW` / `BLOCK` / `ESCALATE` *before* anything
executes. That's a single call ([SDK](./sdk.md) or [`POST /v1/guard`](./api-reference.md)), so
Sentinel is **agnostic to your agent framework and to the provider that performs the action**.

> The Sentinel pieces (`SentinelClient`, `Action`, `guard`) are exact and covered by tests. The
> provider snippets use each SDK's **current** API — pin to the versions you install; their surfaces
> drift, but the integration point never does: **build the action → guard it → execute only on
> `ALLOW`.**

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

## Pick your integration

**Agent frameworks** — gate inside the side-effecting tool:
[Vercel AI SDK](./integrations-vercel.md) ·
[OpenAI Agents SDK](./integrations-openai.md) ·
[Anthropic Claude](./integrations-anthropic.md) ·
[LangChain / LangGraph](./integrations-langchain.md)

**Payments & onchain** — gate the provider call:
[Coinbase CDP](./integrations-coinbase-cdp.md) ·
[Coinbase x402](./integrations-x402.md) ·
[Stripe](./integrations-stripe.md)

## Where it fits any stack

| Stack | Gate at | Schema field |
| --- | --- | --- |
| [Vercel AI SDK](./integrations-vercel.md) | inside the tool's `execute` | `inputSchema` |
| [OpenAI Agents SDK](./integrations-openai.md) | inside the tool's `execute` | `parameters` (+ `name`) |
| [Anthropic Claude](./integrations-anthropic.md) | in the `tool_use` dispatcher | `input_schema` |
| [LangChain · LangGraph](./integrations-langchain.md) | inside the `@tool` body | — |
| [Coinbase CDP wallet](./integrations-coinbase-cdp.md) | before `account.transfer` | — |
| [Coinbase x402](./integrations-x402.md) | before the `402` settles | — |
| [Stripe](./integrations-stripe.md) | before `refunds` / `payouts` / `charges` | — |

The rule is always the same: **guard the action, then execute only on `ALLOW`.** Define what each
policy enforces in [policy packs](./policy-packs.md); the full client API is in the
[SDK reference](./sdk.md).
