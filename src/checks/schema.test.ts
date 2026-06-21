import { test, expect, describe } from 'vitest';
import { SchemaCheck } from './schema.js';
import { Action } from '../core/action.js';

const ctx = { runId: 'r1' };
const paymentSchema = {
  type: 'object',
  required: ['amount', 'from', 'to'],
  properties: {
    amount: { type: 'number', exclusiveMinimum: 0 },
    from: { type: 'string' },
    to: { type: 'string' },
    currency: { type: 'string', enum: ['USD', 'EUR'] },
  },
  additionalProperties: false,
};

describe('SchemaCheck', () => {
  const check = new SchemaCheck({ payment: paymentSchema });

  test('name and tier', () => {
    expect(check.name).toBe('schema');
    expect(check.tier).toBe('fast');
  });

  test('passes a valid payload', async () => {
    const r = await check.run({ action: Action.payment({ amount: 10, from: 'a', to: 'b', currency: 'USD' }), context: ctx });
    expect(r.verdict).toBe('ALLOW');
    expect(r.outcome).toBe('pass');
  });

  test('blocks a payload missing a required field', async () => {
    const r = await check.run({ action: Action.of('payment', { from: 'a', to: 'b' }), context: ctx });
    expect(r.verdict).toBe('BLOCK');
    expect(r.outcome).toBe('fail');
    expect(Array.isArray(r.details?.errors)).toBe(true);
  });

  test('blocks a payload with a wrong-typed field', async () => {
    const r = await check.run({ action: Action.of('payment', { amount: -5, from: 'a', to: 'b' }), context: ctx });
    expect(r.verdict).toBe('BLOCK');
  });

  test('blocks unexpected additional properties', async () => {
    const r = await check.run({ action: Action.of('payment', { amount: 5, from: 'a', to: 'b', sneaky: 1 }), context: ctx });
    expect(r.verdict).toBe('BLOCK');
  });

  test('allows action types with no registered schema (not applicable)', async () => {
    const r = await check.run({ action: Action.of('email', { to: 'x@y.com' }), context: ctx });
    expect(r.verdict).toBe('ALLOW');
  });
});
