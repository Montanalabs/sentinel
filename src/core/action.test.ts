import { test, expect, describe } from 'vitest';
import { Action, actionFingerprint } from './action.js';

describe('Action builders', () => {
  test('payment() builds a well-formed payment action', () => {
    const a = Action.payment({ amount: 42000, from: 'acct_1', to: 'acct_2', currency: 'USD' });
    expect(a.type).toBe('payment');
    expect(a.payload).toMatchObject({ amount: 42000, from: 'acct_1', to: 'acct_2', currency: 'USD' });
    expect(typeof a.id).toBe('string');
    expect(a.id.length).toBeGreaterThan(0);
  });

  test('generates a unique id when none supplied', () => {
    const a = Action.payment({ amount: 1, from: 'a', to: 'b' });
    const b = Action.payment({ amount: 1, from: 'a', to: 'b' });
    expect(a.id).not.toBe(b.id);
  });

  test('respects a caller-supplied id', () => {
    const a = Action.of('db_write', { table: 'users', op: 'update' }, { id: 'act_fixed' });
    expect(a.id).toBe('act_fixed');
    expect(a.type).toBe('db_write');
  });

  test('of() carries optional meta', () => {
    const a = Action.of('email', { to: 'x@y.com' }, { meta: { idempotencyKey: 'k1' } });
    expect(a.meta).toEqual({ idempotencyKey: 'k1' });
  });
});

describe('actionFingerprint', () => {
  test('is identical for structurally-equal actions regardless of key order', () => {
    const a = Action.of('payment', { amount: 5, from: 'a', to: 'b' }, { id: 'x' });
    const b = Action.of('payment', { to: 'b', amount: 5, from: 'a' }, { id: 'x' });
    expect(actionFingerprint(a)).toBe(actionFingerprint(b));
  });

  test('differs when payload differs', () => {
    const a = Action.of('payment', { amount: 5 }, { id: 'x' });
    const b = Action.of('payment', { amount: 6 }, { id: 'x' });
    expect(actionFingerprint(a)).not.toBe(actionFingerprint(b));
  });

  test('is a 64-char hex sha256', () => {
    const a = Action.payment({ amount: 1, from: 'a', to: 'b' });
    expect(actionFingerprint(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
