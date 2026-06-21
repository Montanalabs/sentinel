/**
 * The signed, scoped, single-use authorization receipt.
 *
 * An {@link AuthorizationReceipt} is the cryptographic "go" token a protected executor requires
 * before performing an action. It is issued only for an `ALLOW` adjudication and binds — under one
 * Ed25519 signature — the exact action, context, policy, and evidence that were approved, plus a
 * single-use nonce and an expiry. A downstream executor recomputes the action/context digests from
 * the *actual* request and refuses to run unless they match a valid, unexpired, unconsumed receipt.
 *
 * The signed body covers every field except the signature itself, so nothing security-relevant
 * (verdict, digests, expiry, nonce, issuer, key id, max executions) can be altered after issuance.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical.js';
import type { Verdict } from '../core/types.js';
import { verifySignature } from '../provenance/signing.js';

/** Current adjudication-protocol version stamped into every receipt; validators pin to it. */
export const PROTOCOL_VERSION = 'sentinel.adjudication/1';

/**
 * A signed authorization to execute exactly one protected action.
 *
 * @remarks All fields except `signature` are covered by the signature. `nonce` is a CSPRNG value
 *   consumed exactly once (replay protection); `maxExecutions` starts at 1.
 */
export interface AuthorizationReceipt {
  readonly receiptId: string;
  readonly protocolVersion: string;
  readonly actionDigest: string;
  readonly contextDigest: string;
  readonly policyBundleDigest: string;
  readonly policyVersion: string;
  readonly evidenceDigest: string;
  readonly deterministicVerdict: Verdict;
  readonly modelVerdict?: Verdict;
  readonly finalVerdict: Verdict;
  readonly humanApprovalReference?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly maxExecutions: number;
  readonly issuer: string;
  readonly keyId: string;
  /** base64 Ed25519 signature over the canonical signable body (all fields except this one). */
  readonly signature: string;
}

/** The receipt minus its signature — the exact bytes that are signed and verified. */
export type SignableReceipt = Omit<AuthorizationReceipt, 'signature'>;

/**
 * Canonical signable body of a receipt: deterministic JSON of every field except `signature`.
 *
 * @param r - A receipt (or its pre-signature form).
 * @returns The canonical string that is hashed and signed.
 */
export function receiptSignableBody(r: SignableReceipt): string {
  return canonicalize({
    receiptId: r.receiptId,
    protocolVersion: r.protocolVersion,
    actionDigest: r.actionDigest,
    contextDigest: r.contextDigest,
    policyBundleDigest: r.policyBundleDigest,
    policyVersion: r.policyVersion,
    evidenceDigest: r.evidenceDigest,
    deterministicVerdict: r.deterministicVerdict,
    modelVerdict: r.modelVerdict,
    finalVerdict: r.finalVerdict,
    humanApprovalReference: r.humanApprovalReference,
    issuedAt: r.issuedAt,
    expiresAt: r.expiresAt,
    nonce: r.nonce,
    maxExecutions: r.maxExecutions,
    issuer: r.issuer,
    keyId: r.keyId,
  });
}

/** The bytes that are signed: the SHA-256 of the canonical signable body. */
export function receiptSigningInput(r: SignableReceipt): Buffer {
  return createHash('sha256').update(receiptSignableBody(r)).digest();
}

/**
 * Stable digest identifying a receipt (the SHA-256 of its signable body, hex).
 *
 * Used by an {@link ExecutionReceipt} to reference the authorization it fulfilled without copying
 * the whole receipt.
 */
export function authorizationReceiptDigest(r: SignableReceipt): string {
  return createHash('sha256').update(receiptSignableBody(r)).digest('hex');
}

/**
 * Verify a receipt's Ed25519 signature against a trusted public key.
 *
 * Only checks the signature/integrity of the body — NOT expiry, verdict, replay, or digest match
 * (those belong to the full receipt validator). The caller supplies the public key for the
 * receipt's `keyId` from its trusted-issuer registry; a receipt never carries its own key.
 *
 * @param r - The receipt to check.
 * @param publicKeyRaw - The 32-byte raw Ed25519 public key trusted for `r.keyId`.
 * @returns `true` if the signature is valid for the body under `publicKeyRaw`.
 */
export function verifyReceiptSignature(r: AuthorizationReceipt, publicKeyRaw: Buffer): boolean {
  try {
    return verifySignature(publicKeyRaw, receiptSigningInput(r), Buffer.from(r.signature, 'base64'));
  } catch {
    return false;
  }
}
