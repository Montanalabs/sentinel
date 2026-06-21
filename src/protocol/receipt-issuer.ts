/**
 * Issues signed {@link AuthorizationReceipt}s for `ALLOW` adjudications.
 *
 * Wraps the project's Ed25519 {@link Signer}: it stamps identity/timing/nonce, then signs the
 * canonical body so the receipt is tamper-evident. Receipts are issued ONLY when the final verdict
 * is `ALLOW` — a `BLOCK`/`ESCALATE` decision yields no executable token, which is the whole point.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { Verdict } from '../core/types.js';
import type { Signer } from '../provenance/signing.js';
import { PROTOCOL_VERSION, receiptSigningInput, type AuthorizationReceipt, type SignableReceipt } from './authorization-receipt.js';
import { ProtocolError, ProtocolErrorCode } from './errors.js';

/** Default receipt lifetime if neither the call nor the issuer overrides it (5 minutes). */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** The adjudication outcome an issuer turns into a receipt. */
export interface ReceiptInput {
  readonly actionDigest: string;
  readonly contextDigest: string;
  readonly policyBundleDigest: string;
  readonly policyVersion: string;
  readonly evidenceDigest: string;
  readonly deterministicVerdict: Verdict;
  readonly modelVerdict?: Verdict;
  readonly finalVerdict: Verdict;
  readonly humanApprovalReference?: string;
  /** Permitted executions; defaults to (and must be) 1 for single-use. */
  readonly maxExecutions?: number;
  /** Override the receipt lifetime in ms. */
  readonly ttlMs?: number;
}

/** Construction options for a {@link ReceiptIssuer}. */
export interface ReceiptIssuerOptions {
  /** Stable issuer identity stamped into receipts (e.g. a deployment name). */
  readonly issuer: string;
  /** Default receipt lifetime in ms; defaults to {@link DEFAULT_TTL_MS}. */
  readonly defaultTtlMs?: number;
  /** Monotonic clock in ms; injectable for deterministic tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Mints signed authorization receipts from `ALLOW` adjudications.
 *
 * @see {@link ReceiptIssuer.issue}
 */
export class ReceiptIssuer {
  readonly #signer: Signer;
  readonly #issuer: string;
  readonly #defaultTtlMs: number;
  readonly #now: () => number;

  constructor(signer: Signer, opts: ReceiptIssuerOptions) {
    this.#signer = signer;
    this.#issuer = opts.issuer;
    this.#defaultTtlMs = opts.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.#now = opts.now ?? Date.now;
  }

  /** Key id of the signer that stamps these receipts; pin verifiers to it. */
  get keyId(): string {
    return this.#signer.keyId;
  }

  /**
   * Issue a signed, single-use, expiring receipt for an `ALLOW` decision.
   *
   * @param input - The adjudication outcome to authorize; `finalVerdict` MUST be `ALLOW`.
   * @returns A fully signed {@link AuthorizationReceipt}.
   * @throws {ProtocolError} `INVALID_VERDICT` if `finalVerdict` is not `ALLOW`.
   * @throws {ProtocolError} `MALFORMED_RECEIPT` if `maxExecutions` or `ttlMs` is non-positive.
   */
  issue(input: ReceiptInput): AuthorizationReceipt {
    if (input.finalVerdict !== Verdict.Allow) {
      throw new ProtocolError(ProtocolErrorCode.InvalidVerdict, `receipts are issued only for ALLOW (got ${input.finalVerdict})`);
    }
    const maxExecutions = input.maxExecutions ?? 1;
    if (!Number.isInteger(maxExecutions) || maxExecutions < 1) {
      throw new ProtocolError(ProtocolErrorCode.MalformedReceipt, 'maxExecutions must be a positive integer');
    }
    const ttlMs = input.ttlMs ?? this.#defaultTtlMs;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new ProtocolError(ProtocolErrorCode.MalformedReceipt, 'ttlMs must be positive');
    }

    const now = this.#now();
    const base: SignableReceipt = {
      receiptId: `rcpt_${randomUUID()}`,
      protocolVersion: PROTOCOL_VERSION,
      actionDigest: input.actionDigest,
      contextDigest: input.contextDigest,
      policyBundleDigest: input.policyBundleDigest,
      policyVersion: input.policyVersion,
      evidenceDigest: input.evidenceDigest,
      deterministicVerdict: input.deterministicVerdict,
      ...(input.modelVerdict !== undefined ? { modelVerdict: input.modelVerdict } : {}),
      finalVerdict: input.finalVerdict,
      ...(input.humanApprovalReference !== undefined ? { humanApprovalReference: input.humanApprovalReference } : {}),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      nonce: randomBytes(32).toString('base64'),
      maxExecutions,
      issuer: this.#issuer,
      keyId: this.#signer.keyId,
    };
    const signature = this.#signer.sign(receiptSigningInput(base)).toString('base64');
    return { ...base, signature };
  }
}
