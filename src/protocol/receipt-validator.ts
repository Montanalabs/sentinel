/**
 * Validates an {@link AuthorizationReceipt} before a protected action may execute.
 *
 * This is the enforcement point: it checks the receipt is supported, well-formed, signed by a
 * *trusted* issuer (the receipt never carries its own key — the validator holds a pinned
 * keyId→key registry, so a receipt cannot vouch for itself), unexpired, an `ALLOW`, and bound to
 * the EXACT action and context the executor is about to run. Only after every other check passes
 * does it atomically consume the nonce — so a failed validation never burns a single-use receipt.
 * Every failure is a typed {@link ProtocolError}; the validator fails closed on anything unexpected.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { NonceStore } from '../store/nonce-store.js';
import { Verdict } from '../core/types.js';
import { ProtocolError, ProtocolErrorCode } from './errors.js';
import { PROTOCOL_VERSION, verifyReceiptSignature, type AuthorizationReceipt } from './authorization-receipt.js';
import type { RevocationStore } from './revocation-store.js';

/** Constant-time equality for two hex digests (length mismatch → not equal, no timing leak). */
function digestEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** What the executor knows about the action it is about to run, to match against the receipt. */
export interface ExecutionBinding {
  /** Digest the executor independently computed from the ACTUAL action (never agent-supplied). */
  readonly actionDigest: string;
  /** Digest of the current execution context. */
  readonly contextDigest: string;
  /** Expected policy digest; when set, the receipt's must match (`POLICY_MISMATCH`). */
  readonly expectedPolicyBundleDigest?: string;
  /** When true, the receipt must carry a `humanApprovalReference`. */
  readonly requireHumanApproval?: boolean;
}

/** Construction dependencies and tuning for a {@link ReceiptValidator}. */
export interface ReceiptValidatorOptions {
  /** Trusted issuers: map of `keyId` → 32-byte raw Ed25519 public key. */
  readonly trustedKeys: ReadonlyMap<string, Buffer>;
  /** Replay-protection store; the nonce is consumed here on success. */
  readonly nonceStore: NonceStore;
  /** Optional revocation list. */
  readonly revocations?: RevocationStore;
  /** Supported protocol versions; defaults to the current {@link PROTOCOL_VERSION}. */
  readonly protocolVersions?: ReadonlySet<string>;
  /** Clock (ms); injectable for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Successful validation: the receipt is valid and a nonce slot was claimed. */
export interface ValidationOk {
  readonly ok: true;
  readonly executionCount: number;
}

/** Failed validation, carrying the typed reason. */
export interface ValidationFailure {
  readonly ok: false;
  readonly error: ProtocolError;
}

export type ValidationResult = ValidationOk | ValidationFailure;

/** Validates authorization receipts and consumes their single-use nonce. */
export class ReceiptValidator {
  readonly #trustedKeys: ReadonlyMap<string, Buffer>;
  readonly #nonces: NonceStore;
  readonly #revocations: RevocationStore | undefined;
  readonly #versions: ReadonlySet<string>;
  readonly #now: () => number;

  constructor(opts: ReceiptValidatorOptions) {
    this.#trustedKeys = opts.trustedKeys;
    this.#nonces = opts.nonceStore;
    this.#revocations = opts.revocations;
    this.#versions = opts.protocolVersions ?? new Set([PROTOCOL_VERSION]);
    this.#now = opts.now ?? Date.now;
  }

  /**
   * Validate `receipt` for the action/context the executor is about to run.
   *
   * Performs all non-destructive checks first and consumes the nonce LAST, so only a fully valid
   * receipt is spent. Returns a structured result rather than throwing, so the executor can record
   * the precise failure.
   *
   * @param receipt - The authorization receipt presented with the action.
   * @param binding - The executor's independently-derived action/context digests and requirements.
   * @returns `{ ok: true, executionCount }` or `{ ok: false, error }`.
   */
  async validate(receipt: AuthorizationReceipt, binding: ExecutionBinding): Promise<ValidationResult> {
    const fail = (code: ProtocolErrorCode, msg: string): ValidationFailure => ({ ok: false, error: new ProtocolError(code, msg) });

    if (!this.#versions.has(receipt.protocolVersion)) {
      return fail(ProtocolErrorCode.UnsupportedProtocolVersion, `unsupported protocol version: ${receipt.protocolVersion}`);
    }
    if (!isStructurallyValid(receipt)) {
      return fail(ProtocolErrorCode.MalformedReceipt, 'receipt is structurally malformed');
    }
    if (receipt.finalVerdict !== Verdict.Allow) {
      return fail(ProtocolErrorCode.InvalidVerdict, `final verdict is not ALLOW: ${receipt.finalVerdict}`);
    }

    const key = this.#trustedKeys.get(receipt.keyId);
    if (!key) return fail(ProtocolErrorCode.UntrustedIssuer, `untrusted issuer key: ${receipt.keyId}`);
    if (!verifyReceiptSignature(receipt, key)) {
      return fail(ProtocolErrorCode.InvalidSignature, 'receipt signature did not verify');
    }

    const now = this.#now();
    const expiresAt = Date.parse(receipt.expiresAt);
    const issuedAt = Date.parse(receipt.issuedAt);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(issuedAt)) {
      return fail(ProtocolErrorCode.MalformedReceipt, 'receipt has invalid timestamps');
    }
    if (now >= expiresAt) return fail(ProtocolErrorCode.ExpiredReceipt, 'receipt has expired');
    if (now < issuedAt) return fail(ProtocolErrorCode.NotYetValid, 'receipt is not yet valid');

    if (!digestEquals(receipt.actionDigest, binding.actionDigest)) {
      return fail(ProtocolErrorCode.ActionMismatch, 'action digest does not match the authorized action');
    }
    if (!digestEquals(receipt.contextDigest, binding.contextDigest)) {
      return fail(ProtocolErrorCode.ContextMismatch, 'context digest does not match the authorized context');
    }
    if (binding.expectedPolicyBundleDigest !== undefined && !digestEquals(receipt.policyBundleDigest, binding.expectedPolicyBundleDigest)) {
      return fail(ProtocolErrorCode.PolicyMismatch, 'policy digest does not match the executing policy');
    }
    if (binding.requireHumanApproval && !receipt.humanApprovalReference) {
      return fail(ProtocolErrorCode.MissingHumanApproval, 'human approval is required but absent');
    }

    if (this.#revocations && (await this.#revocations.isRevoked(receipt.receiptId))) {
      return fail(ProtocolErrorCode.RevokedReceipt, 'receipt has been revoked');
    }

    // All checks passed — claim the single-use slot LAST so a rejected receipt is never spent.
    const consumed = await this.#nonces.consume(receipt.receiptId, receipt.nonce, receipt.maxExecutions);
    if (!consumed.consumed) {
      return fail(ProtocolErrorCode.ReplayDetected, 'receipt nonce already consumed (replay)');
    }
    return { ok: true, executionCount: consumed.executionCount };
  }
}

/** Cheap structural well-formedness check (presence/shape) before doing crypto/timing work. */
function isStructurallyValid(r: AuthorizationReceipt): boolean {
  const hex = /^[0-9a-f]{64}$/;
  return (
    typeof r.receiptId === 'string' &&
    typeof r.nonce === 'string' &&
    r.nonce.length > 0 &&
    typeof r.keyId === 'string' &&
    typeof r.signature === 'string' &&
    Number.isInteger(r.maxExecutions) &&
    r.maxExecutions >= 1 &&
    hex.test(r.actionDigest) &&
    hex.test(r.contextDigest) &&
    hex.test(r.policyBundleDigest) &&
    hex.test(r.evidenceDigest)
  );
}

/** Convenience SHA-256 hex for callers building an {@link ExecutionBinding} from raw context. */
export function contextDigestOf(canonicalContext: string): string {
  return createHash('sha256').update(canonicalContext).digest('hex');
}
