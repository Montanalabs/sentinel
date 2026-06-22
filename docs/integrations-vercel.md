# Vercel AI SDK

Gate the **tool that has side effects**, not the model. Put `guard()` inside the tool's `execute`;
the model sees a refusal it can react to. `tool()` uses **`inputSchema`** (AI SDK v5+; it was
`parameters` in v4). See the shared [pattern](./integrations.md#the-pattern).

```ts
import { tool } from 'ai';
import { z } from 'zod';
import { SentinelClient, Action } from '@montanalabs/sentinel';

const sentinel = new SentinelClient({ endpoint: process.env.SENTINEL_URL! });

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

Returning the refusal (rather than throwing) lets the model read `BLOCK` / `ESCALATE` and adapt —
e.g. ask for approval or pick a smaller amount.
