import { test, expect, describe } from 'vitest';
import { Signer, verifySignature } from './signing.js';

describe('Signer (Ed25519)', () => {
  test('fromSeed is deterministic: same seed -> same keyId and public key', () => {
    const seed = Buffer.alloc(32, 7);
    const a = Signer.fromSeed(seed);
    const b = Signer.fromSeed(seed);
    expect(a.keyId).toBe(b.keyId);
    expect(a.publicKeyRaw.equals(b.publicKeyRaw)).toBe(true);
    expect(a.publicKeyRaw.length).toBe(32);
  });

  test('different seeds produce different keys', () => {
    const a = Signer.fromSeed(Buffer.alloc(32, 1));
    const b = Signer.fromSeed(Buffer.alloc(32, 2));
    expect(a.keyId).not.toBe(b.keyId);
  });

  test('keyId is namespaced and hex', () => {
    const s = Signer.fromSeed(Buffer.alloc(32, 9));
    expect(s.keyId).toMatch(/^ed25519:[0-9a-f]{64}$/);
  });

  test('sign then verify succeeds', () => {
    const s = Signer.fromSeed(Buffer.alloc(32, 3));
    const msg = Buffer.from('hello sentinel');
    const sig = s.sign(msg);
    expect(verifySignature(s.publicKeyRaw, msg, sig)).toBe(true);
  });

  test('verify fails on tampered message', () => {
    const s = Signer.fromSeed(Buffer.alloc(32, 4));
    const sig = s.sign(Buffer.from('original'));
    expect(verifySignature(s.publicKeyRaw, Buffer.from('tampered'), sig)).toBe(false);
  });

  test('verify fails with the wrong public key', () => {
    const s = Signer.fromSeed(Buffer.alloc(32, 5));
    const other = Signer.fromSeed(Buffer.alloc(32, 6));
    const msg = Buffer.from('m');
    expect(verifySignature(other.publicKeyRaw, msg, s.sign(msg))).toBe(false);
  });

  test('generate() produces a working random signer', () => {
    const s = Signer.generate();
    const msg = Buffer.from('x');
    expect(verifySignature(s.publicKeyRaw, msg, s.sign(msg))).toBe(true);
  });
});
