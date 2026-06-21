import { test, expect, describe } from 'vitest';
import { canonicalize } from './canonical.js';

describe('canonicalize', () => {
  test('produces identical output regardless of key insertion order', () => {
    const a = canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalize({ c: { x: 2, y: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
  });

  test('serializes nested objects with sorted keys', () => {
    expect(canonicalize({ z: { b: 2, a: 1 }, a: 3 })).toBe('{"a":3,"z":{"a":1,"b":2}}');
  });

  test('preserves array order (arrays are ordered)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  test('handles primitives, null, booleans, numbers, strings', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('x')).toBe('"x"');
  });

  test('omits undefined object properties deterministically', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  test('is stable across repeated calls', () => {
    const obj = { amount: 100, to: 'acct_2', from: 'acct_1', nested: { k: [1, 2], j: 'v' } };
    expect(canonicalize(obj)).toBe(canonicalize(obj));
  });
});
