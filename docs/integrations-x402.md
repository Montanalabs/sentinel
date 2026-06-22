# Coinbase x402

[x402](https://github.com/coinbase/x402) (`@x402/fetch`) settles a payment in response to an HTTP
`402`. Probe the price, gate it, then let the payment-enabled fetch settle only on `ALLOW`. See the
shared [pattern](./integrations.md#the-pattern).

```ts
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { SentinelClient, Action } from '@montanalabs/sentinel';

const sentinel = new SentinelClient({ endpoint: process.env.SENTINEL_URL! });

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

Because `wrapFetchWithPayment` settles automatically, the gate goes on the **probe** — you guard the
price the server quotes before the paying fetch runs.
