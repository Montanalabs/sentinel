import { test, expect, describe } from 'vitest';
import { PolicyRegistry } from './registry.js';
import { fintechPaymentsPack } from './fintech-payments.js';

describe('PolicyRegistry', () => {
  test('resolves registered packs and throws on unknown', () => {
    const r = new PolicyRegistry().register(fintechPaymentsPack());
    expect(r.has('fintech.payments')).toBe(true);
    expect(r.list()).toContain('fintech.payments');
    expect(r.resolve('fintech.payments').length).toBeGreaterThan(0);
    expect(() => r.resolve('nope')).toThrow();
  });
});
