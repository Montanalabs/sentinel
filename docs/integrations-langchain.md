# LangChain / LangGraph

Gate inside the `@tool` body. The same tool works in a classic LangChain agent or a LangGraph
`create_react_agent`. See the shared [pattern](./integrations.md#the-pattern).

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

Returning the refusal string keeps the agent loop intact — the model reads `BLOCK` / `ESCALATE` and
decides what to do next instead of crashing the run.
