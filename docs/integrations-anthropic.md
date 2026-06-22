# Anthropic Claude

Claude's Messages API defines tools with **`input_schema`**. Gate inside the loop that dispatches
`tool_use` blocks, and return the verdict as the `tool_result`. See the shared
[pattern](./integrations.md#the-pattern).

```ts
import Anthropic from '@anthropic-ai/sdk';
import { SentinelClient, Action } from '@montanalabs/sentinel';

const sentinel = new SentinelClient({ endpoint: process.env.SENTINEL_URL! });

const tools = [{
  name: 'send_payment',
  description: 'Send a payment to a vendor',
  input_schema: {
    type: 'object',
    properties: { amount: { type: 'number' }, to: { type: 'string' } },
    required: ['amount', 'to'],
  },
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
    : `refused (${decision.verdict}): ${decision.reason}`;
  return { type: 'tool_result', tool_use_id: block.id, content: String(content) };
}
```

The same dispatcher pattern applies when Claude's tools are exposed over **MCP** — gate inside the
MCP tool handler before performing the action.
