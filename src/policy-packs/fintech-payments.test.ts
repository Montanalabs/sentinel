import { test, expect, describe } from 'vitest';
import { PolicyRegistry } from './registry.js';
import { fintechPaymentsPack } from './fintech-payments.js';
import { healthcareRecordsPack } from './healthcare-records.js';
import { Engine } from '../engine/engine.js';
import { InMemoryStore } from '../store/memory.js';
import { RecordBuilder } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { StaticLedgerConnector } from '../connectors/static-ledger.js';
import { MockProvider } from '../providers/mock.js';
import { Action } from '../core/action.js';
import type { Provider } from '../providers/types.js';
import { Verdict } from '../core/types.js';
import type { AgentContext, GuardRequest } from '../core/types.js';

const ledger = new StaticLedgerConnector({ balances: { acct_1: 5000, acct_rich: 100000 }, sanctioned: ['acct_evil'] });

function engineWith(provider: Provider) {
  const registry = new PolicyRegistry({ ledger, provider })
    .register(fintechPaymentsPack({ highValueThreshold: 25000, approvers: ['treasury_ops'] }))
    .register(healthcareRecordsPack({ allowedProviders: ['anthropic'], allowedRegions: ['US'] }));
  const store = new InMemoryStore();
  const builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 51)));
  return new Engine({ resolve: (id) => registry.resolve(id), builder, store, slowBudgetMs: 1000 });
}

const ctx: AgentContext = { runId: 'run_1', provider: 'anthropic' };
const pay = (payload: Record<string, unknown>, context: AgentContext = ctx): GuardRequest => ({
  action: Action.of('payment', payload),
  context,
  policy: 'fintech.payments',
});

describe('fintech.payments pack (through the engine)', () => {
  const agree = new MockProvider(() => ({ agree: true }));

  test('allows a small, well-funded, clean payment', async () => {
    const d = await engineWith(agree).guard(pay({ amount: 100, from: 'acct_1', to: 'acct_ok' }));
    expect(d.verdict).toBe(Verdict.Allow);
  });

  test('blocks an overdraw via numeric reconciliation', async () => {
    const d = await engineWith(agree).guard(pay({ amount: 8000, from: 'acct_1', to: 'acct_ok' }));
    expect(d.verdict).toBe(Verdict.Block);
    expect(d.reason).toMatch(/insufficient funds|reconcile/i);
  });

  test('escalates a high-value transfer for dual control', async () => {
    const d = await engineWith(agree).guard(pay({ amount: 50000, from: 'acct_rich', to: 'acct_ok' }));
    expect(d.verdict).toBe(Verdict.Escalate);
  });

  test('blocks a sanctioned counterparty via the ledger connector', async () => {
    const d = await engineWith(agree).guard(pay({ amount: 100, from: 'acct_1', to: 'acct_evil' }));
    expect(d.verdict).toBe(Verdict.Block);
  });

  test('blocks a schema-invalid payment (missing from)', async () => {
    const d = await engineWith(agree).guard(pay({ amount: 100, to: 'acct_ok' }));
    expect(d.verdict).toBe(Verdict.Block);
  });

  test('escalates when the independent model disagrees', async () => {
    const disagree = new MockProvider(() => ({ agree: false, rationale: 'unusual recipient' }));
    const d = await engineWith(disagree).guard(pay({ amount: 100, from: 'acct_1', to: 'acct_ok' }));
    expect(d.verdict).toBe(Verdict.Escalate);
  });
});
