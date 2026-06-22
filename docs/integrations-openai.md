# OpenAI Agents SDK

Gate inside the tool's `execute`. `tool()` from `@openai/agents` requires a **`name`** and uses
**`parameters`** (Zod). See the shared [pattern](./integrations.md#the-pattern).

```ts
import { tool } from '@openai/agents';
import { z } from 'zod';
import { SentinelClient, Action } from '@montanalabs/sentinel';

const sentinel = new SentinelClient({ endpoint: process.env.SENTINEL_URL! });

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

The tool returns the refusal string to the agent loop, so the model can explain or retry rather than
silently failing.
