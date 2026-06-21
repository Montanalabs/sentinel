import { test, expect, describe } from 'vitest';
import { NumericReconcileCheck, Relation } from './reconcile.js';
import { Action } from '../core/action.js';

const ctx = { runId: 'r1' };
const action = (amount: number) => Action.payment({ amount, from: 'acct_1', to: 'acct_2' });

describe('NumericReconcileCheck', () => {
  test('name and tier (slow, external lookup)', () => {
    const c = new NumericReconcileCheck({
      field: 'action.payload.amount',
      relation: Relation.Lte,
      source: async () => 1000,
    });
    expect(c.name).toBe('reconcile:action.payload.amount');
    expect(c.tier).toBe('slow');
  });

  test('passes when amount satisfies the relation vs source-of-truth', async () => {
    const c = new NumericReconcileCheck({ field: 'action.payload.amount', relation: Relation.Lte, source: async () => 1000 });
    const r = await c.run({ action: action(800), context: ctx });
    expect(r.verdict).toBe('ALLOW');
    expect(r.details).toMatchObject({ value: 800, truth: 1000, relation: 'lte' });
  });

  test('blocks when amount violates the relation (overdraw)', async () => {
    const c = new NumericReconcileCheck({ field: 'action.payload.amount', relation: Relation.Lte, source: async () => 500, reason: 'insufficient funds' });
    const r = await c.run({ action: action(800), context: ctx });
    expect(r.verdict).toBe('BLOCK');
    expect(r.reason).toMatch(/insufficient funds/);
  });

  test('escalates (inconclusive) when source-of-truth is unavailable', async () => {
    const c = new NumericReconcileCheck({ field: 'action.payload.amount', relation: Relation.Lte, source: async () => undefined });
    const r = await c.run({ action: action(800), context: ctx });
    expect(r.verdict).toBe('ESCALATE');
    expect(r.outcome).toBe('inconclusive');
  });

  test('blocks when the field is not numeric', async () => {
    const c = new NumericReconcileCheck({ field: 'action.payload.amount', relation: Relation.Lte, source: async () => 1000 });
    const r = await c.run({ action: Action.of('payment', { amount: 'oops' }), context: ctx });
    expect(r.verdict).toBe('BLOCK');
    expect(r.reason).toMatch(/numeric/);
  });

  test('supports eq relation', async () => {
    const c = new NumericReconcileCheck({ field: 'action.payload.amount', relation: Relation.Eq, source: async () => 800 });
    expect((await c.run({ action: action(800), context: ctx })).verdict).toBe('ALLOW');
    expect((await c.run({ action: action(801), context: ctx })).verdict).toBe('BLOCK');
  });
});
