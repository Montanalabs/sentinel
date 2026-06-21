/**
 * SDK integration example: drive a running Sentinel sidecar through the agent SDK.
 *
 * This is what an agent actually does — import the dependency-free
 * `@montanalabs/sentinel-sdk`, point it at the sidecar, and gate each proposed
 * action through `guard()` before executing it. It validates the full round-trip:
 * SDK → HTTP → sidecar → verdict, plus a tamper-evident chain check.
 *
 * Prereq: a sidecar must be running. In another terminal:
 *   npm run sidecar                 # provider from .env (real Claude/GPT calls)
 *   SENTINEL_SECOND_OPINION_PROVIDER=mock npm run sidecar   # offline, no API key
 *
 * Then:
 *   npm run example:sdk             # defaults to http://localhost:4000
 *   SENTINEL_URL=http://localhost:4056 npm run example:sdk
 *
 * NOTE: while the standalone `@montanalabs/sentinel-sdk` is unpublished, it is wired
 * as a local `file:` dependency in package.json. Once it ships to npm it becomes a
 * normal version range and this example is unchanged.
 */
import {
  SentinelClient,
  Action,
  type GuardDecision,
} from "@montanalabs/sentinel-sdk";

const endpoint = process.env.SENTINEL_URL ?? "http://localhost:4000";

/** Pretty-print one decision with an ANSI-coloured verdict. */
function show(label: string, decision: GuardDecision): void {
  const color =
    decision.verdict === "ALLOW" ? 32 : decision.verdict === "BLOCK" ? 31 : 33;
  const tag = `\x1b[${color}m${decision.verdict.padEnd(8)}\x1b[0m`;
  const reason = decision.reason ? `  — ${decision.reason}` : "";
  const esc = decision.escalationId
    ? `  (escalation ${decision.escalationId})`
    : "";
  console.log(`  ${tag} ${label}${reason}${esc}`);
}

async function main(): Promise<void> {
  // 0) Liveness: make sure a sidecar is actually there before we start.
  try {
    const health = await fetch(`${endpoint}/healthz`);
    if (!health.ok) throw new Error(`healthz ${health.status}`);
  } catch (err) {
    console.error(
      `\nERROR: No sidecar reachable at ${endpoint} (${(err as Error).message}).`,
    );
    console.error(
      "  Start one with:  SENTINEL_SECOND_OPINION_PROVIDER=mock npm run sidecar\n",
    );
    process.exit(1);
  }
  console.log(`\nSentinel SDK → ${endpoint}\n`);

  // 1) The agent gates each proposed action through the SDK before acting.
  const client = new SentinelClient({
    endpoint,
    failMode: "closed",
    timeoutMs: 30_000,
  });
  const context = {
    runId: "sdk-integration-1",
    provider: "anthropic",
    actor: { id: "agent-007", roles: ["ops"] },
  };

  const scenarios: ReadonlyArray<
    readonly [string, ReturnType<typeof Action.of>]
  > = [
    [
      "clean, well-funded payment",
      Action.payment({ amount: 100, from: "acct_ops", to: "vendor_42" }),
    ],
    [
      "sanctioned counterparty",
      Action.payment({ amount: 100, from: "acct_ops", to: "acct_ofac_1" }),
    ],
    [
      "overdraw (amount > balance)",
      Action.payment({ amount: 9_999_999, from: "acct_1", to: "vendor_42" }),
    ],
    [
      "high-value (dual-control)",
      Action.payment({
        amount: 80_000,
        from: "acct_treasury",
        to: "vendor_42",
      }),
    ],
  ];

  console.log("1) Gating proposed actions through the SDK:");
  let allowed = 0;
  for (const [label, action] of scenarios) {
    const decision = await client.guard(action, context, "fintech.payments");
    show(label, decision);
    // This is the whole point: only execute when the gate says ALLOW.
    if (SentinelClient.allowed(decision)) allowed++;
  }

  // 2) Prove the gate produced a tamper-evident, verifiable provenance chain.
  const verify = (await (await fetch(`${endpoint}/v1/verify`)).json()) as {
    ok: boolean;
  };
  const records = (await (
    await fetch(`${endpoint}/v1/records`)
  ).json()) as unknown[];
  console.log(
    `\n2) Provenance chain: ${verify.ok ? "intact" : "BROKEN"} (${records.length} signed records)`,
  );

  console.log(
    `\nSDK integration validated: ${scenarios.length} actions gated, ${allowed} allowed, chain ${verify.ok ? "verified" : "FAILED"}.\n`,
  );
  process.exit(verify.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("SDK integration example failed:", err);
  process.exit(1);
});
