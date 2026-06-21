import { test, expect, describe, beforeEach } from 'vitest';
import { Signer } from '../provenance/signing.js';
import { Verdict } from '../core/types.js';
import { InMemoryNonceStore } from '../store/nonce-memory.js';
import { ReceiptIssuer } from './receipt-issuer.js';
import { ReceiptValidator, type ExecutionBinding } from './receipt-validator.js';
import { InMemoryRevocationStore } from './revocation-store.js';
import { ProtocolErrorCode } from './errors.js';
import type { AuthorizationReceipt } from './authorization-receipt.js';

const signer = Signer.fromSeed(Buffer.alloc(32, 3));
const NOW = 1_000_000_000;
const ACTION = 'a'.repeat(64);
const CTX = 'c'.repeat(64);
const POLICY = 'f'.repeat(64);

function makeIssuer(now = () => NOW) {
  return new ReceiptIssuer(signer, { issuer: 'gate', now, defaultTtlMs: 60_000 });
}

function allow(issuer = makeIssuer(), over: Partial<Parameters<ReceiptIssuer['issue']>[0]> = {}): AuthorizationReceipt {
  return issuer.issue({
    actionDigest: ACTION,
    contextDigest: CTX,
    policyBundleDigest: POLICY,
    policyVersion: 'v1',
    evidenceDigest: 'e'.repeat(64),
    deterministicVerdict: Verdict.Allow,
    finalVerdict: Verdict.Allow,
    ...over,
  });
}

describe('ReceiptValidator', () => {
  let nonces: InMemoryNonceStore;
  let revocations: InMemoryRevocationStore;
  let validator: ReceiptValidator;
  const binding: ExecutionBinding = { actionDigest: ACTION, contextDigest: CTX };

  beforeEach(() => {
    nonces = new InMemoryNonceStore();
    revocations = new InMemoryRevocationStore();
    validator = new ReceiptValidator({
      trustedKeys: new Map([[signer.keyId, signer.publicKeyRaw]]),
      nonceStore: nonces,
      revocations,
      now: () => NOW,
    });
  });

  test('accepts a valid receipt and consumes one nonce slot', async () => {
    const res = await validator.validate(allow(), binding);
    expect(res).toEqual({ ok: true, executionCount: 1 });
  });

  test('rejects replay (second validate of the same receipt)', async () => {
    const r = allow();
    expect((await validator.validate(r, binding)).ok).toBe(true);
    const second = await validator.validate(r, binding);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe(ProtocolErrorCode.ReplayDetected);
  });

  test('an untrusted issuer key is rejected', async () => {
    const stranger = new ReceiptIssuer(Signer.fromSeed(Buffer.alloc(32, 99)), { issuer: 'evil', now: () => NOW });
    const res = await validator.validate(allow(stranger), binding);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ProtocolErrorCode.UntrustedIssuer);
  });

  test('a tampered signature is rejected', async () => {
    const r = allow();
    const badSig = Buffer.from(r.signature, 'base64');
    badSig[0] = (badSig[0] ?? 0) ^ 0xff;
    const res = await validator.validate({ ...r, signature: badSig.toString('base64') }, binding);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ProtocolErrorCode.InvalidSignature);
  });

  test('an expired receipt is rejected (and the nonce is NOT consumed)', async () => {
    const r = allow(); // expires at NOW + 60s
    const late = new ReceiptValidator({
      trustedKeys: new Map([[signer.keyId, signer.publicKeyRaw]]),
      nonceStore: nonces,
      now: () => NOW + 120_000,
    });
    const res = await late.validate(r, binding);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ProtocolErrorCode.ExpiredReceipt);
    // The nonce was not burned — a fresh validator at a valid time still accepts it.
    expect((await validator.validate(r, binding)).ok).toBe(true);
  });

  test('action / context mismatch is rejected and does not burn the nonce', async () => {
    const r = allow();
    const mismatch = await validator.validate(r, { ...binding, actionDigest: 'b'.repeat(64) });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe(ProtocolErrorCode.ActionMismatch);
    const ctxBad = await validator.validate(r, { ...binding, contextDigest: 'd'.repeat(64) });
    if (!ctxBad.ok) expect(ctxBad.error.code).toBe(ProtocolErrorCode.ContextMismatch);
    // Still consumable after the rejected attempts.
    expect((await validator.validate(r, binding)).ok).toBe(true);
  });

  test('policy mismatch is rejected when an expected policy digest is supplied', async () => {
    const res = await validator.validate(allow(), { ...binding, expectedPolicyBundleDigest: 'z'.repeat(64) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ProtocolErrorCode.PolicyMismatch);
  });

  test('missing human approval is rejected when required', async () => {
    const res = await validator.validate(allow(), { ...binding, requireHumanApproval: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ProtocolErrorCode.MissingHumanApproval);
    // With the approval reference present, it passes.
    const approved = allow(makeIssuer(), { humanApprovalReference: 'esc_123' });
    expect((await validator.validate(approved, { ...binding, requireHumanApproval: true })).ok).toBe(true);
  });

  test('a revoked receipt is rejected', async () => {
    const r = allow();
    await revocations.revoke(r.receiptId);
    const res = await validator.validate(r, binding);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ProtocolErrorCode.RevokedReceipt);
  });

  test('an unsupported protocol version is rejected', async () => {
    const res = await validator.validate({ ...allow(), protocolVersion: 'other/9' }, binding);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ProtocolErrorCode.UnsupportedProtocolVersion);
  });
});
