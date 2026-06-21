import { test, expect, describe, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { EscalationManager } from './escalation.js';
import { Engine } from '../engine/engine.js';
import { InMemoryStore } from '../store/memory.js';
import { RecordBuilder } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { PolicyCheck, RuleEffect, type PolicyDefinition } from '../checks/policy.js';
import { CompareOp } from '../checks/condition.js';
import { Action } from '../core/action.js';

const policy: PolicyDefinition = {
  id: 'p',
  rules: [
    { id: 'deny', when: { field: 'action.payload.to', op: CompareOp.In, value: ['bad'] }, effect: RuleEffect.Block, reason: 'sanctioned' },
    { id: 'high', when: { field: 'action.payload.amount', op: CompareOp.Gt, value: 25000 }, effect: RuleEffect.RequireApproval, approvers: ['ops'] },
  ],
};

function makeApp() {
  const store = new InMemoryStore();
  const builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 181)));
  const engine = new Engine({ resolve: () => [new PolicyCheck(policy)], builder, store });
  return buildServer({ engine, store, escalations: new EscalationManager(), builder });
}

const guard = (app: FastifyInstance, amount: number, to = 'ok') =>
  app.inject({ method: 'POST', url: '/v1/guard', payload: { action: Action.payment({ amount, from: 'a', to }), context: { runId: 'r1' }, policy: 'p' } });

describe('GET /v1/analytics', () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = makeApp();
  });

  test('returns decision analytics over the provenance store', async () => {
    await guard(app, 100);
    await guard(app, 100, 'bad'); // block
    await guard(app, 50000); // escalate
    const res = await app.inject({ method: 'GET', url: '/v1/analytics' });
    expect(res.statusCode).toBe(200);
    const a = res.json();
    expect(a.total).toBe(3);
    expect(a.byVerdict).toEqual({ ALLOW: 1, BLOCK: 1, ESCALATE: 1 });
    expect(typeof a.blockRate).toBe('number');
    expect(Array.isArray(a.topReasons)).toBe(true);
  });
});

describe('dashboard UI', () => {
  test('GET /dashboard serves an HTML page', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('Sentinel');
    expect(res.body).toContain('Decision'); // the decision feed/section
    expect(res.body).toContain('/v1/analytics'); // client wires to the API
  });

  test('GET / redirects to the dashboard', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/' });
    expect([301, 302]).toContain(res.statusCode);
    expect(res.headers.location).toBe('/dashboard');
  });
});
