/**
 * The signed receipt an executor emits AFTER running a protected action.
 *
 * An {@link ExecutionReceipt} closes the loop: it binds the authorization that permitted the action
 * (by id and digest), the exact action that was actually executed, the result, and the executor's
 * identity — under the executor's own Ed25519 signature. Together with the authorization receipt and
 * the nonce ledger, it lets an auditor prove complete mediation: every protected execution maps to
 * exactly one valid authorization for exactly that action.
 *
 * Execution failure is recorded as a status, never conflated with authorization failure: a valid
 * authorization whose downstream call failed yields a signed `FAILED` execution receipt.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical.js';
import type { Signer } from '../provenance/signing.js';
import { verifySignature } from '../provenance/signing.js';

/** Terminal status of a protected execution. */
export enum ExecutionStatus {
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
  PartiallyCompleted = 'PARTIALLY_COMPLETED',
  /** The action was refused before execution (e.g. receipt validation failed). */
  Rejected = 'REJECTED',
}

/** A signed record that a specific protected action was (or was not) executed under a given receipt. */
export interface ExecutionReceipt {
  readonly executionId: string;
  readonly authorizationReceiptId: string;
  readonly authorizationReceiptDigest: string;
  readonly actualActionDigest: string;
  readonly executorIdentity: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly resultDigest: string;
  readonly executionStatus: ExecutionStatus;
  readonly externalReference?: string;
  readonly keyId: string;
  /** base64 Ed25519 signature over the canonical body (all fields except this one). */
  readonly signature: string;
}

/** The inputs an executor supplies to mint an {@link ExecutionReceipt}. */
export interface ExecutionReceiptInput {
  readonly authorizationReceiptId: string;
  readonly authorizationReceiptDigest: string;
  readonly actualActionDigest: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly resultDigest: string;
  readonly executionStatus: ExecutionStatus;
  readonly externalReference?: string;
}

type SignableExecution = Omit<ExecutionReceipt, 'signature'>;

/** Canonical signable body of an execution receipt (every field except `signature`). */
export function executionSignableBody(r: SignableExecution): string {
  return canonicalize({
    executionId: r.executionId,
    authorizationReceiptId: r.authorizationReceiptId,
    authorizationReceiptDigest: r.authorizationReceiptDigest,
    actualActionDigest: r.actualActionDigest,
    executorIdentity: r.executorIdentity,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    resultDigest: r.resultDigest,
    executionStatus: r.executionStatus,
    externalReference: r.externalReference,
    keyId: r.keyId,
  });
}

function executionSigningInput(r: SignableExecution): Buffer {
  return createHash('sha256').update(executionSignableBody(r)).digest();
}

/**
 * Verify an execution receipt's signature against a trusted executor public key.
 *
 * @param r - The execution receipt.
 * @param publicKeyRaw - The 32-byte raw Ed25519 public key trusted for `r.keyId`.
 * @returns `true` if the signature is valid for the body.
 */
export function verifyExecutionReceiptSignature(r: ExecutionReceipt, publicKeyRaw: Buffer): boolean {
  try {
    return verifySignature(publicKeyRaw, executionSigningInput(r), Buffer.from(r.signature, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Signs {@link ExecutionReceipt}s for one executor identity.
 *
 * Held by a protected executor; its key id is what auditors pin when verifying execution receipts.
 */
export class ExecutionReceiptSigner {
  readonly #signer: Signer;
  readonly #identity: string;
  readonly #newId: () => string;

  /**
   * @param signer - The executor's Ed25519 identity.
   * @param executorIdentity - Stable executor name stamped into every receipt.
   * @param newId - Execution-id generator (injectable for tests); defaults to `exec_<uuid>`.
   */
  constructor(signer: Signer, executorIdentity: string, newId: () => string) {
    this.#signer = signer;
    this.#identity = executorIdentity;
    this.#newId = newId;
  }

  /** Key id of the executor's signer; pin verifiers to it. */
  get keyId(): string {
    return this.#signer.keyId;
  }

  /** Mint and sign an execution receipt. */
  sign(input: ExecutionReceiptInput): ExecutionReceipt {
    const base: SignableExecution = {
      executionId: this.#newId(),
      authorizationReceiptId: input.authorizationReceiptId,
      authorizationReceiptDigest: input.authorizationReceiptDigest,
      actualActionDigest: input.actualActionDigest,
      executorIdentity: this.#identity,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      resultDigest: input.resultDigest,
      executionStatus: input.executionStatus,
      ...(input.externalReference !== undefined ? { externalReference: input.externalReference } : {}),
      keyId: this.#signer.keyId,
    };
    const signature = this.#signer.sign(executionSigningInput(base)).toString('base64');
    return { ...base, signature };
  }
}
