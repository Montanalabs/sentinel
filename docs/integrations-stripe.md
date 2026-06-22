# Stripe

Gate the sensitive call directly with the [`guarded()`](./integrations.md#the-pattern) helper:

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
> payouts, subscriptions), gate them with a framework recipe (e.g.
> [Vercel AI SDK](./integrations-vercel.md)) instead of exposing the raw tool.
