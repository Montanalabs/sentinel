import { test, expect, describe } from 'vitest';
import { buildServer } from './server.js';
import { EscalationManager } from './escalation.js';
import { Engine } from '../engine/engine.js';
import { InMemoryStore } from '../store/memory.js';
import { RecordBuilder, verifyChain } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { PolicyCheck, RuleEffect, type PolicyDefinition } from '../checks/policy.js';
import { CompareOp } from '../checks/condition.js';
import { Action } from '../core/action.js';

const policy: PolicyDefinition = {
  id: 'p',
  rules: [{ id: 'high', when: { field: 'action.payload.amount', op: CompareOp.Gt, value: 25000 }, effect: RuleEffect.RequireApproval, approvers: ['ops'] }],
};

function makeApp() {
  const store = new InMemoryStore();
  const builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 131)));
  const engine = new Engine({ resolve: () => [new PolicyCheck(policy)], builder, store });
  return { app: buildServer({ engine, store, escalations: new EscalationManager(), builder }), store };
}

describe('POST /v1/guard/batch', () => {
  test('gates a multi-agent fan-out and keeps one verifiable chain', async () => {
    const { app, store } = makeApp();
    const mk = (amount: number) => ({ action: Action.payment({ amount, from: 'a', to: 'b' }), context: { runId: 'run_fanout' }, policy: 'p' });
    const res = await app.inject({ method: 'POST', url: '/v1/guard/batch', payload: { requests: [mk(100), mk(50000), mk(200)] } });
    expect(res.statusCode).toBe(200);
    const { decisions } = res.json();
    expect(decisions).toHaveLength(3);
    expect(decisions[1].verdict).toBe('ESCALATE');
    expect(decisions[1].escalationId).toMatch(/^esc_/);
    expect(verifyChain(await store.list())).toEqual({ ok: true });
  });
});
