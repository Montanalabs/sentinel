import { test, expect, describe, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { EscalationManager } from './escalation.js';
import { Engine } from '../engine/engine.js';
import { InMemoryStore } from '../store/memory.js';
import { RecordBuilder, verifyChain } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { PolicyCheck, RuleEffect, type PolicyDefinition } from '../checks/policy.js';
import { UnknownPolicyError } from '../policy-packs/registry.js';
import { CompareOp } from '../checks/condition.js';
import { Action } from '../core/action.js';

const policy: PolicyDefinition = {
  id: 'fintech.payments',
  rules: [
    { id: 'deny_sanctioned', when: { field: 'action.payload.to', op: CompareOp.In, value: ['acct_evil'] }, effect: RuleEffect.Block, reason: 'sanctioned' },
    { id: 'dual_control', when: { field: 'action.payload.amount', op: CompareOp.Gt, value: 25000 }, effect: RuleEffect.RequireApproval, approvers: ['treasury_ops'], reason: 'high value' },
  ],
};

function makeApp() {
  const store = new InMemoryStore();
  const builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 41)));
  const engine = new Engine({ resolve: () => [new PolicyCheck(policy)], builder, store });
  const escalations = new EscalationManager();
  const app = buildServer({ engine, store, escalations, builder });
  return { app, store };
}

const guard = (app: FastifyInstance, amount: number, to = 'acct_ok') =>
  app.inject({
    method: 'POST',
    url: '/v1/guard',
    payload: { action: Action.payment({ amount, from: 'acct_1', to }), context: { runId: 'run_1', provider: 'anthropic' }, policy: 'fintech.payments' },
  });

describe('sidecar HTTP server', () => {
  let app: FastifyInstance;
  let store: InMemoryStore;
  beforeEach(() => {
    ({ app, store } = makeApp());
  });

  test('GET /healthz', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  test('GET /readyz reports ready when the store is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready' });
  });

  test('GET /readyz returns 503 when the store is unavailable', async () => {
    const s = new InMemoryStore();
    s.tail = async () => {
      throw new Error('connection refused');
    };
    const builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 42)));
    const brokenApp = buildServer({ engine: new Engine({ resolve: () => [], builder, store: s }), store: s, escalations: new EscalationManager(), builder });
    const res = await brokenApp.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
  });

  test('POST /v1/guard allows a small payment', async () => {
    const res = await guard(app, 100);
    expect(res.statusCode).toBe(200);
    expect(res.json().verdict).toBe('ALLOW');
    expect(res.json().recordId).toMatch(/^rec_/);
  });

  test('POST /v1/guard blocks a sanctioned counterparty', async () => {
    expect((await guard(app, 100, 'acct_evil')).json().verdict).toBe('BLOCK');
  });

  test('POST /v1/guard escalates high value and creates an escalation', async () => {
    const res = await guard(app, 50000);
    const body = res.json();
    expect(body.verdict).toBe('ESCALATE');
    expect(body.escalationId).toMatch(/^esc_/);
    const list = await app.inject({ method: 'GET', url: '/v1/escalations?status=pending' });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].approvers).toEqual(['treasury_ops']);
  });

  test('rejects an invalid guard body with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/guard', payload: { context: { runId: 'x' }, policy: 'p' } });
    expect(res.statusCode).toBe(400);
  });

  test('an unknown policy fails closed with 400 (not a 500), surfacing the reason', async () => {
    const store = new InMemoryStore();
    const builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 43)));
    // Resolve like the real registry: throw UnknownPolicyError for an unregistered id.
    const engine = new Engine({
      resolve: (id) => {
        if (id !== 'fintech.payments') throw new UnknownPolicyError(id);
        return [new PolicyCheck(policy)];
      },
      builder,
      store,
    });
    const unknownApp = buildServer({ engine, store, escalations: new EscalationManager(), builder });
    const res = await unknownApp.inject({
      method: 'POST',
      url: '/v1/guard',
      payload: { action: Action.payment({ amount: 100, from: 'a', to: 'b' }), context: { runId: 'r' }, policy: 'does.not.exist' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.statusCode).not.toBe(500);
    expect(res.json().error).toContain('unknown policy pack: does.not.exist');
  });

  test('GET /v1/records returns appended records and filters', async () => {
    await guard(app, 100);
    await guard(app, 100, 'acct_evil');
    const all = await app.inject({ method: 'GET', url: '/v1/records' });
    expect(all.json()).toHaveLength(2);
    const blocks = await app.inject({ method: 'GET', url: '/v1/records?verdict=BLOCK' });
    expect(blocks.json()).toHaveLength(1);
  });

  test('GET /v1/records/:id returns a record or 404', async () => {
    const id = (await guard(app, 100)).json().recordId;
    expect((await app.inject({ method: 'GET', url: `/v1/records/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/records/rec_nope' })).statusCode).toBe(404);
  });

  test('GET /v1/verify confirms the chain', async () => {
    await guard(app, 100);
    await guard(app, 50000);
    const res = await app.inject({ method: 'GET', url: '/v1/verify' });
    expect(res.json()).toEqual({ ok: true });
  });

  test('an off-list approver cannot resolve an escalation', async () => {
    const escId = (await guard(app, 50000)).json().escalationId; // approvers: ['treasury_ops']
    const res = await app.inject({
      method: 'POST',
      url: `/v1/escalations/${escId}/resolve`,
      payload: { decision: 'approve', approver: 'random_person' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('resolving an escalation appends a human-decision record and keeps the chain valid', async () => {
    const escId = (await guard(app, 50000)).json().escalationId;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/escalations/${escId}/resolve`,
      payload: { decision: 'approve', approver: 'treasury_ops' }, // in the escalation's approver list
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recordId).toMatch(/^rec_/);
    expect(res.json().escalation.status).toBe('approved');
    const chain = await store.list();
    expect(verifyChain(chain)).toEqual({ ok: true });
    // the human-decision record references the original escalation
    const human = chain.find((r) => r.checks.some((c) => c.check === 'human.review'));
    expect(human?.verdict).toBe('ALLOW');
  });
});
