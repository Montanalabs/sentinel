import { test, expect, describe } from 'vitest';
import { PolicyRegistry } from './registry.js';
import { fintechPaymentsPack } from './fintech-payments.js';
import { healthcareRecordsPack } from './healthcare-records.js';
import { Engine } from '../engine/engine.js';
import { InMemoryStore } from '../store/memory.js';
import { RecordBuilder } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { StaticLedgerConnector } from '../connectors/static-ledger.js';
import { StaticClinicalConnector } from '../connectors/static-clinical.js';
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

describe('healthcare.record_write pack (through the engine)', () => {
  const agree = new MockProvider(() => ({ agree: true }));
  const record = (payload: Record<string, unknown>, context: AgentContext = ctx): GuardRequest => ({
    action: Action.of('record_update', payload, { meta: { region: context.provider === 'anthropic' ? 'US' : 'US' } }),
    context,
    policy: 'healthcare.record_write',
  });

  test('allows a benign, non-significant record update', async () => {
    const d = await engineWith(agree).guard(record({ patientId: 'p1', field: 'note', value: 'follow-up scheduled' }));
    expect(d.verdict).toBe(Verdict.Allow);
  });

  test('escalates a clinically-significant change for sign-off', async () => {
    const d = await engineWith(agree).guard(record({ patientId: 'p1', field: 'diagnosis', value: 'X', clinicalSignificant: true }));
    expect(d.verdict).toBe(Verdict.Escalate);
  });

  test('blocks PHI routed to a non-cleared provider', async () => {
    const d = await engineWith(agree).guard(
      record({ patientId: 'p1', field: 'note', value: 'x', ssn: '123-45-6789' }, { runId: 'r', provider: 'openai' }),
    );
    expect(d.verdict).toBe(Verdict.Block);
    expect(d.reason).toMatch(/provider|boundary|PII/i);
  });
});

describe('healthcare pack with clinical connector', () => {
  const clinical = new StaticClinicalConnector({ patients: ['p1'], allergies: { p1: ['penicillin'] } });

  function engine() {
    const registry = new PolicyRegistry({ clinical, provider: new MockProvider(() => ({ agree: true })) }).register(
      healthcareRecordsPack({ allowedProviders: ['anthropic'], allowedRegions: ['US'] }),
    );
    return new Engine({
      resolve: (id) => registry.resolve(id),
      builder: new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 151))),
      store: new InMemoryStore(),
      slowBudgetMs: 1000,
    });
  }

  const record = (payload: Record<string, unknown>) => ({
    action: Action.of('record_update', payload, { meta: { region: 'US' } }),
    context: { runId: 'r', provider: 'anthropic' },
    policy: 'healthcare.record_write',
  });

  test('allows a record update for a known patient', async () => {
    const d = await engine().guard(record({ patientId: 'p1', field: 'note', value: 'ok' }));
    expect(d.verdict).toBe(Verdict.Allow);
  });

  test('blocks a record write for an unknown patient (ground-truth)', async () => {
    const d = await engine().guard(record({ patientId: 'p999', field: 'note', value: 'ok' }));
    expect(d.verdict).toBe(Verdict.Block);
    expect(d.reason).toMatch(/unknown patient/);
  });
});
