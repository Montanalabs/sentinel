# Coinbase CDP

Gate a wallet transfer (`@coinbase/cdp-sdk`) before it broadcasts, so a hijacked key or a
hallucinated transfer can't move funds on its own. Wrap the call in the
[`guarded()`](./integrations.md#the-pattern) helper:

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

A `crypto.transfers` policy can enforce per-transaction and rolling daily caps, allow/deny lists, and
dual-control sign-off above a threshold — verified independently of the agent, with a signed record
of every decision.

> Using **Coinbase AgentKit** (`@coinbase/agentkit`)? Its actions are wired into your framework as
> tools — gate them with the framework recipe (e.g. [Vercel AI SDK](./integrations-vercel.md) or
> [OpenAI Agents SDK](./integrations-openai.md)) by wrapping the transfer action's executor, rather
> than exposing the raw write tool.
