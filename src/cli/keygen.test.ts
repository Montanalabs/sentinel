import { test, expect, describe } from 'vitest';
import { generateSigningSeed } from './keygen.js';
import { Signer } from '../provenance/signing.js';

describe('generateSigningSeed', () => {
  test('returns a base64 32-byte seed usable by Signer.fromSeed', () => {
    const seed = generateSigningSeed();
    const buf = Buffer.from(seed, 'base64');
    expect(buf.length).toBe(32);
    expect(Signer.fromSeed(buf).keyId).toMatch(/^ed25519:[0-9a-f]{16}$/);
  });

  test('is random each call', () => {
    expect(generateSigningSeed()).not.toBe(generateSigningSeed());
  });
});
