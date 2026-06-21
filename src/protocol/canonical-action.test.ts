import { test, expect, describe } from 'vitest';
import { actionDigest, toCanonicalAction, type CanonicalAction } from './canonical-action.js';
import { ProtocolError, ProtocolErrorCode } from './errors.js';

const base: CanonicalAction = {
  actionType: 'payment',
  targetService: 'core-banking',
  operation: 'transfer',
  parameters: { amount: 1000, from: 'acct_ops', to: 'vendor_42' },
  actorId: 'agent-007',
  tenant: 'acme',
};

describe('actionDigest', () => {
  test('is a lowercase hex SHA-256', () => {
    expect(actionDigest(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('key ordering does not change the digest', () => {
    const reordered: CanonicalAction = {
      tenant: 'acme',
      actorId: 'agent-007',
      parameters: { to: 'vendor_42', from: 'acct_ops', amount: 1000 }, // params reordered too
      operation: 'transfer',
      targetService: 'core-banking',
      actionType: 'payment',
    };
    expect(actionDigest(reordered)).toBe(actionDigest(base));
  });

  test('semantically equivalent actions digest identically', () => {
    const equivalent = { ...base, parameters: { amount: 1000, from: 'acct_ops', to: 'vendor_42' } };
    expect(actionDigest(equivalent)).toBe(actionDigest(base));
  });

  test('a materially different parameter changes the digest', () => {
    expect(actionDigest({ ...base, parameters: { ...base.parameters, amount: 1001 } })).not.toBe(actionDigest(base));
    expect(actionDigest({ ...base, operation: 'reverse' })).not.toBe(actionDigest(base));
    expect(actionDigest({ ...base, targetService: 'other' })).not.toBe(actionDigest(base));
    expect(actionDigest({ ...base, actorId: 'agent-008' })).not.toBe(actionDigest(base));
  });

  test('absent optional field vs explicit value do not collide', () => {
    const withScope = { ...base, scope: '' };
    expect(actionDigest(withScope)).not.toBe(actionDigest(base));
  });
});

describe('toCanonicalAction — fail safe on non-canonical input', () => {
  test('rejects a missing/blank required field', () => {
    expect(() => actionDigest({ ...base, operation: '' })).toThrow(ProtocolError);
    try {
      actionDigest({ ...base, actorId: '   ' });
    } catch (e) {
      expect((e as ProtocolError).code).toBe(ProtocolErrorCode.NonCanonicalAction);
    }
  });

  test('rejects non-object parameters', () => {
    expect(() => actionDigest({ ...base, parameters: [1, 2, 3] as unknown as Record<string, unknown> })).toThrow(/object/);
  });

  test('rejects non-deterministic values (function, bigint, non-finite)', () => {
    expect(() => actionDigest({ ...base, parameters: { f: () => 1 } as unknown as Record<string, unknown> })).toThrow(ProtocolError);
    expect(() => actionDigest({ ...base, parameters: { n: 10n } as unknown as Record<string, unknown> })).toThrow(ProtocolError);
    expect(() => actionDigest({ ...base, parameters: { x: Number.POSITIVE_INFINITY } })).toThrow(/non-finite/);
  });

  test('drops undefined object properties without throwing (matches canonicalize)', () => {
    const a = toCanonicalAction({ ...base, parameters: { amount: 1, note: undefined } });
    expect(a.parameters).toEqual({ amount: 1, note: undefined });
    expect(actionDigest({ ...base, parameters: { amount: 1, note: undefined } })).toBe(actionDigest({ ...base, parameters: { amount: 1 } }));
  });
});
