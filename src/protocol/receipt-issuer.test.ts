import { test, expect, describe } from 'vitest';
import { Signer } from '../provenance/signing.js';
import { Verdict } from '../core/types.js';
import { ReceiptIssuer, type ReceiptInput } from './receipt-issuer.js';
import { verifyReceiptSignature, PROTOCOL_VERSION } from './authorization-receipt.js';
import { ProtocolError, ProtocolErrorCode } from './errors.js';

const signer = Signer.fromSeed(Buffer.alloc(32, 7));
const issuer = new ReceiptIssuer(signer, { issuer: 'test-gate', now: () => 1_000_000 });

const allowInput: ReceiptInput = {
  actionDigest: 'a'.repeat(64),
  contextDigest: 'c'.repeat(64),
  policyBundleDigest: 'p'.repeat(64),
  policyVersion: 'fintech.payments@1',
  evidenceDigest: 'e'.repeat(64),
  deterministicVerdict: Verdict.Allow,
  modelVerdict: Verdict.Allow,
  finalVerdict: Verdict.Allow,
};

describe('ReceiptIssuer', () => {
  test('issues a fully-signed receipt for ALLOW, single-use, expiring', () => {
    const r = issuer.issue(allowInput);
    expect(r.receiptId).toMatch(/^rcpt_/);
    expect(r.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(r.finalVerdict).toBe(Verdict.Allow);
    expect(r.maxExecutions).toBe(1);
    expect(r.keyId).toBe(signer.keyId);
    expect(r.issuer).toBe('test-gate');
    expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(new Date(r.issuedAt).getTime());
    // CSPRNG nonce, 32 bytes base64.
    expect(Buffer.from(r.nonce, 'base64')).toHaveLength(32);
    expect(verifyReceiptSignature(r, signer.publicKeyRaw)).toBe(true);
  });

  test('every issued receipt has a unique nonce and id', () => {
    const a = issuer.issue(allowInput);
    const b = issuer.issue(allowInput);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.receiptId).not.toBe(b.receiptId);
  });

  test('refuses to issue for BLOCK or ESCALATE', () => {
    for (const v of [Verdict.Block, Verdict.Escalate]) {
      try {
        issuer.issue({ ...allowInput, finalVerdict: v });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as ProtocolError).code).toBe(ProtocolErrorCode.InvalidVerdict);
      }
    }
  });

  test('rejects a non-positive maxExecutions', () => {
    expect(() => issuer.issue({ ...allowInput, maxExecutions: 0 })).toThrow(ProtocolError);
  });

  test('the signature covers security-relevant fields (tampering breaks it)', () => {
    const r = issuer.issue(allowInput);
    // Tamper with the verdict / digests / expiry / nonce / maxExecutions — each must invalidate.
    expect(verifyReceiptSignature({ ...r, finalVerdict: Verdict.Block }, signer.publicKeyRaw)).toBe(false);
    expect(verifyReceiptSignature({ ...r, actionDigest: 'b'.repeat(64) }, signer.publicKeyRaw)).toBe(false);
    expect(verifyReceiptSignature({ ...r, expiresAt: '2099-01-01T00:00:00.000Z' }, signer.publicKeyRaw)).toBe(false);
    expect(verifyReceiptSignature({ ...r, nonce: Buffer.alloc(32, 9).toString('base64') }, signer.publicKeyRaw)).toBe(false);
    expect(verifyReceiptSignature({ ...r, maxExecutions: 1000 }, signer.publicKeyRaw)).toBe(false);
    expect(verifyReceiptSignature({ ...r, keyId: 'ed25519:0000000000000000' }, signer.publicKeyRaw)).toBe(false);
  });

  test('a different signer key does not verify (no self-vouching)', () => {
    const r = issuer.issue(allowInput);
    const other = Signer.fromSeed(Buffer.alloc(32, 99));
    expect(verifyReceiptSignature(r, other.publicKeyRaw)).toBe(false);
  });
});
