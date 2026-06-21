import { test, expect, describe } from 'vitest';
import { resolveField, evaluateCondition, CompareOp, type Condition } from './condition.js';

const scope = {
  action: { type: 'payment', payload: { amount: 42000, from: 'a', to: 'b' }, meta: { region: 'EU' } },
  context: { runId: 'r1', actor: { id: 'u1', roles: ['analyst'] } },
};

describe('resolveField', () => {
  test('resolves nested dotted paths', () => {
    expect(resolveField('action.type', scope)).toBe('payment');
    expect(resolveField('action.payload.amount', scope)).toBe(42000);
    expect(resolveField('context.actor.roles', scope)).toEqual(['analyst']);
  });
  test('returns undefined for missing paths', () => {
    expect(resolveField('action.payload.nope', scope)).toBeUndefined();
    expect(resolveField('nothing.here', scope)).toBeUndefined();
  });
  test('refuses prototype-chain traversal (no __proto__/constructor)', () => {
    expect(resolveField('action.__proto__', scope)).toBeUndefined();
    expect(resolveField('action.constructor', scope)).toBeUndefined();
    expect(resolveField('action.constructor.prototype', scope)).toBeUndefined();
  });
});

describe('numeric comparison type-confusion (fail-safe)', () => {
  test('a stringified amount cannot evade a > threshold block rule', () => {
    const evade = { action: { payload: { amount: '50000' } } };
    // amount "50000" (string) must still be seen as > 25000 so the block rule fires.
    expect(evaluateCondition({ field: 'action.payload.amount', op: CompareOp.Gt, value: 25000 }, evade)).toBe(true);
  });
  test('genuinely non-numeric operands compare false', () => {
    const obj = { action: { payload: { amount: { nested: true } } } };
    expect(evaluateCondition({ field: 'action.payload.amount', op: CompareOp.Gt, value: 1 }, obj)).toBe(false);
  });

  test('eq/ne/in are numeric-consistent: a stringified value cannot evade an identity rule', () => {
    const s = { action: { payload: { amount: '100', code: '7' } } };
    expect(evaluateCondition({ field: 'action.payload.amount', op: CompareOp.Eq, value: 100 }, s)).toBe(true);
    expect(evaluateCondition({ field: 'action.payload.amount', op: CompareOp.Ne, value: 100 }, s)).toBe(false);
    expect(evaluateCondition({ field: 'action.payload.code', op: CompareOp.In, value: [5, 7, 9] }, s)).toBe(true);
    expect(evaluateCondition({ field: 'action.payload.code', op: CompareOp.Nin, value: [5, 7, 9] }, s)).toBe(false);
    // Non-numeric strings keep exact-match semantics.
    expect(evaluateCondition({ field: 'action.payload.amount', op: CompareOp.Eq, value: 'abc' }, s)).toBe(false);
  });
});

describe('evaluateCondition', () => {
  test('comparison operators', () => {
    expect(evaluateCondition({ field: 'action.payload.amount', op: CompareOp.Gt, value: 25000 }, scope)).toBe(true);
    expect(evaluateCondition({ field: 'action.payload.amount', op: CompareOp.Lte, value: 25000 }, scope)).toBe(false);
    expect(evaluateCondition({ field: 'action.type', op: CompareOp.Eq, value: 'payment' }, scope)).toBe(true);
    expect(evaluateCondition({ field: 'action.type', op: CompareOp.Ne, value: 'email' }, scope)).toBe(true);
  });

  test('in / nin against arrays', () => {
    expect(evaluateCondition({ field: 'action.payload.to', op: CompareOp.In, value: ['b', 'c'] }, scope)).toBe(true);
    expect(evaluateCondition({ field: 'action.payload.to', op: CompareOp.Nin, value: ['x', 'y'] }, scope)).toBe(true);
  });

  test('contains: field array contains value', () => {
    expect(evaluateCondition({ field: 'context.actor.roles', op: CompareOp.Contains, value: 'analyst' }, scope)).toBe(true);
    expect(evaluateCondition({ field: 'context.actor.roles', op: CompareOp.Contains, value: 'admin' }, scope)).toBe(false);
  });

  test('all (AND)', () => {
    const c: Condition = {
      all: [
        { field: 'action.type', op: CompareOp.Eq, value: 'payment' },
        { field: 'action.payload.amount', op: CompareOp.Gt, value: 1000 },
      ],
    };
    expect(evaluateCondition(c, scope)).toBe(true);
  });

  test('any (OR)', () => {
    const c: Condition = {
      any: [
        { field: 'action.type', op: CompareOp.Eq, value: 'email' },
        { field: 'action.payload.amount', op: CompareOp.Gt, value: 1000 },
      ],
    };
    expect(evaluateCondition(c, scope)).toBe(true);
  });

  test('not', () => {
    expect(evaluateCondition({ not: { field: 'action.type', op: CompareOp.Eq, value: 'email' } }, scope)).toBe(true);
  });

  test('missing field compares safely (no throw)', () => {
    expect(evaluateCondition({ field: 'action.payload.nope', op: CompareOp.Gt, value: 5 }, scope)).toBe(false);
  });
});
