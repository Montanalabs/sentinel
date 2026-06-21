/**
 * Enforces the protocol at the point of execution.
 *
 * A {@link ProtectedExecutor} wraps a protected operation so it runs ONLY against a valid
 * authorization receipt for *exactly* that action. It independently canonicalizes the action it is
 * about to run (never trusting an agent-supplied digest), validates and atomically consumes the
 * receipt, executes the handler only on success, and emits a signed {@link ExecutionReceipt}
 * binding the authorization to the actual result. A receipt that fails validation yields a signed
 * `REJECTED` receipt and the handler never runs; a handler that throws yields a signed `FAILED`
 * receipt — execution failure is never conflated with authorization failure.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical.js';
import { actionDigest, type CanonicalAction } from './canonical-action.js';
import { authorizationReceiptDigest, type AuthorizationReceipt } from './authorization-receipt.js';
import type { ReceiptValidator } from './receipt-validator.js';
import { ExecutionReceiptSigner, ExecutionStatus, type ExecutionReceipt } from './execution-receipt.js';
import { ProtocolError } from './errors.js';

/** SHA-256 hex of the canonical form of a value (default result-digest function). */
function digestOf(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

/** Arguments to {@link ProtectedExecutor.execute}. */
export interface ProtectedExecuteArgs<T> {
  /** The action to run, in canonical form; its digest is recomputed here, not taken on trust. */
  readonly action: CanonicalAction;
  /** Digest of the current execution context, matched against the receipt. */
  readonly contextDigest: string;
  /** The authorization receipt presented with the action. */
  readonly receipt: AuthorizationReceipt;
  /** The protected operation to perform once authorization is confirmed. */
  readonly handler: () => Promise<T>;
  /** Optional expected policy digest the receipt must match. */
  readonly expectedPolicyBundleDigest?: string;
  /** Require the receipt to carry a human-approval reference. */
  readonly requireHumanApproval?: boolean;
  /** Optional external reference (e.g. a bank transaction id) recorded on the execution receipt. */
  readonly externalReference?: string;
  /** Custom result→digest function; defaults to SHA-256 of the canonical result. */
  readonly digestResult?: (result: T) => string;
}

/** Outcome of a protected execution: status, the result (on success), any error, and the receipt. */
export interface ProtectedExecutionResult<T> {
  readonly status: ExecutionStatus;
  readonly result?: T;
  readonly error?: Error;
  readonly executionReceipt: ExecutionReceipt;
}

/** Runs protected operations behind receipt validation and emits signed execution receipts. */
export class ProtectedExecutor {
  readonly #validator: ReceiptValidator;
  readonly #signer: ExecutionReceiptSigner;
  readonly #now: () => number;

  constructor(validator: ReceiptValidator, signer: ExecutionReceiptSigner, opts: { now?: () => number } = {}) {
    this.#validator = validator;
    this.#signer = signer;
    this.#now = opts.now ?? Date.now;
  }

  /**
   * Validate authorization, then execute — producing a signed execution receipt either way.
   *
   * @param args - The action, context, receipt, and handler; see {@link ProtectedExecuteArgs}.
   * @returns The execution outcome, always including a signed {@link ExecutionReceipt}.
   */
  async execute<T>(args: ProtectedExecuteArgs<T>): Promise<ProtectedExecutionResult<T>> {
    const startedAt = new Date(this.#now()).toISOString();
    const actualActionDigest = actionDigest(args.action); // derived from the REAL action
    const authDigest = authorizationReceiptDigest(args.receipt);

    const validation = await this.#validator.validate(args.receipt, {
      actionDigest: actualActionDigest,
      contextDigest: args.contextDigest,
      ...(args.expectedPolicyBundleDigest !== undefined ? { expectedPolicyBundleDigest: args.expectedPolicyBundleDigest } : {}),
      ...(args.requireHumanApproval !== undefined ? { requireHumanApproval: args.requireHumanApproval } : {}),
    });

    if (!validation.ok) {
      // Rejected before execution: the handler never runs; record the refusal.
      const receipt = this.#mint({
        receipt: args.receipt,
        authDigest,
        actualActionDigest,
        startedAt,
        resultDigest: digestOf({ rejected: validation.error.code }),
        status: ExecutionStatus.Rejected,
        externalReference: args.externalReference,
      });
      return { status: ExecutionStatus.Rejected, error: validation.error, executionReceipt: receipt };
    }

    // Authorized — run the protected operation. A throw here is an EXECUTION failure, not an
    // authorization failure (the slot is already legitimately consumed).
    const digestResult = args.digestResult ?? digestOf;
    try {
      const result = await args.handler();
      const receipt = this.#mint({
        receipt: args.receipt,
        authDigest,
        actualActionDigest,
        startedAt,
        resultDigest: digestResult(result),
        status: ExecutionStatus.Succeeded,
        externalReference: args.externalReference,
      });
      return { status: ExecutionStatus.Succeeded, result, executionReceipt: receipt };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const receipt = this.#mint({
        receipt: args.receipt,
        authDigest,
        actualActionDigest,
        startedAt,
        resultDigest: digestOf({ error: error.message }),
        status: ExecutionStatus.Failed,
        externalReference: args.externalReference,
      });
      return { status: ExecutionStatus.Failed, error, executionReceipt: receipt };
    }
  }

  #mint(args: {
    receipt: AuthorizationReceipt;
    authDigest: string;
    actualActionDigest: string;
    startedAt: string;
    resultDigest: string;
    status: ExecutionStatus;
    externalReference: string | undefined;
  }): ExecutionReceipt {
    return this.#signer.sign({
      authorizationReceiptId: args.receipt.receiptId,
      authorizationReceiptDigest: args.authDigest,
      actualActionDigest: args.actualActionDigest,
      startedAt: args.startedAt,
      completedAt: new Date(this.#now()).toISOString(),
      resultDigest: args.resultDigest,
      executionStatus: args.status,
      ...(args.externalReference !== undefined ? { externalReference: args.externalReference } : {}),
    });
  }
}
