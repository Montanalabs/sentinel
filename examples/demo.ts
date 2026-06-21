/**
 * End-to-end Sentinel demo: boots a real sidecar, drives it over HTTP,
 * exercises ALLOW / BLOCK / ESCALATE, resolves an escalation, verifies the
 * tamper-evident chain, and exports GRC evidence.
 *
 *   npm run demo
 *
 * Uses the second-opinion provider from .env (anthropic by default). Set
 * SENTINEL_SECOND_OPINION_PROVIDER=mock to run fully offline.
 */
import { loadEnvFile, loadConfig } from '../src/config.js';
import { buildSentinel } from '../src/sidecar/bootstrap.js';
import type { GuardDecision } from '../src/core/types.js';
import { StaticLedgerConnector } from '../src/connectors/static-ledger.js';
import { analyze } from '../src/analytics/analytics.js';
import { Action } from '../src/core/action.js';
import type { ProvenanceRecord } from '../src/provenance/record.js';

const PORT = 4055;
const line = (s = '') => console.log(s);
const title = (s: string) => line(`\n\x1b[1m${s}\x1b[0m`);

async function main(): Promise<void> {
  loadEnvFile();
  const { databaseUrl: _ignored, ...config } = loadConfig();

  const ledger = new StaticLedgerConnector({
    balances: { acct_ops: 250_000, acct_1: 5_000 },
    sanctioned: ['acct_ofac_1'],
  });

  const sentinel = await buildSentinel({ ...config, sidecarPort: PORT }, { ledger });
  await sentinel.app.listen({ port: PORT, host: '127.0.0.1' });
  const endpoint = `http://127.0.0.1:${PORT}`;
  line(`Sentinel sidecar up on ${endpoint} (signer ${sentinel.signer.keyId}, provider ${config.secondOpinionProvider})`);

  // The agent calls the gate over HTTP. In a real agent, use the @montanalabs/sentinel-sdk client.
  const guard = async (action: ReturnType<typeof Action.of>): Promise<GuardDecision> =>
    (await (
      await fetch(`${endpoint}/v1/guard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, context: ctx, policy: 'fintech.payments' }),
      })
    ).json()) as GuardDecision;

  const ctx = { runId: 'demo-run-1', provider: 'anthropic', model: 'claude-sonnet-4-6', actor: { id: 'agent-007', roles: ['ops'] } };
  const scenarios: Array<[string, ReturnType<typeof Action.payment>]> = [
    ['small, well-funded payment', Action.payment({ amount: 200, from: 'acct_ops', to: 'vendor_42' })],
    ['overdraw (amount > balance)', Action.payment({ amount: 9_999, from: 'acct_1', to: 'vendor_42' })],
    ['high-value (dual-control)', Action.payment({ amount: 80_000, from: 'acct_ops', to: 'vendor_42' })],
    ['sanctioned counterparty', Action.payment({ amount: 100, from: 'acct_ops', to: 'acct_ofac_1' })],
    ['schema-invalid (missing from)', Action.of('payment', { amount: 100, to: 'vendor_42' })],
  ];

  title('1) Gating consequential actions');
  for (const [name, action] of scenarios) {
    const d = await guard(action);
    const color = d.verdict === 'ALLOW' ? 32 : d.verdict === 'BLOCK' ? 31 : 33;
    line(`  \x1b[${color}m${d.verdict.padEnd(8)}\x1b[0m ${name}${d.reason ? `  — ${d.reason}` : ''}`);
  }

  title('2) Human-in-the-loop: resolve the escalation');
  const pending = (await (await fetch(`${endpoint}/v1/escalations?status=pending`)).json()) as Array<{ id: string; approvers: string[] }>;
  for (const e of pending) {
    const res = await fetch(`${endpoint}/v1/escalations/${e.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve', approver: 'treasurer_jane' }),
    });
    const body = (await res.json()) as { recordId: string };
    line(`  approved ${e.id} (approvers: ${e.approvers.join(', ')}) -> human-decision record ${body.recordId}`);
  }

  title('3) Tamper-evident audit chain');
  const verify = await (await fetch(`${endpoint}/v1/verify`)).json();
  line(`  GET /v1/verify -> ${JSON.stringify(verify)}`);
  const records = (await (await fetch(`${endpoint}/v1/records`)).json()) as ProvenanceRecord[];
  line(`  ${records.length} signed records in the chain`);

  title('4) Decision analytics');
  const a = analyze(records);
  line(`  verdicts: ${JSON.stringify(a.byVerdict)}  blockRate=${a.blockRate.toFixed(2)} escalateRate=${a.escalateRate.toFixed(2)}`);

  await sentinel.close();
  line('\nDemo complete. Sidecar closed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
