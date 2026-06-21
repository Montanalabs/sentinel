/**
 * Complete-mediation audit over the authorization and execution record sets.
 *
 * Proves the protocol's central invariant after the fact: *every protected execution corresponds to
 * exactly one valid authorization receipt, and the executed action exactly matches the authorized
 * action.* The auditor cross-references signed authorization receipts against signed execution
 * receipts and reports every deviation by type, plus a coverage fraction. It is a pure function
 * over the record sets (no I/O), so it can run in a CLI, an API handler, or an external auditor's
 * own tooling against exported records.
 */

import { authorizationReceiptDigest, verifyReceiptSignature, type AuthorizationReceipt } from './authorization-receipt.js';
import { verifyExecutionReceiptSignature, ExecutionStatus, type ExecutionReceipt } from './execution-receipt.js';
import { Verdict } from '../core/types.js';

/** The ways an execution can violate complete mediation. */
export enum AuditViolationType {
  ExecutionWithoutAuthorization = 'EXECUTION_WITHOUT_AUTHORIZATION',
  MultipleAuthorizations = 'MULTIPLE_AUTHORIZATIONS',
  ActionSubstitution = 'ACTION_SUBSTITUTION',
  ExpiredAuthorization = 'EXPIRED_AUTHORIZATION',
  InvalidAuthorizationSignature = 'INVALID_AUTHORIZATION_SIGNATURE',
  InvalidExecutionSignature = 'INVALID_EXECUTION_SIGNATURE',
  ReplayedAuthorization = 'REPLAYED_AUTHORIZATION',
  MissingPolicyCommitment = 'MISSING_POLICY_COMMITMENT',
  MissingEvidenceCommitment = 'MISSING_EVIDENCE_COMMITMENT',
  /** The authorization existed but its final verdict was not ALLOW. */
  NonAllowAuthorization = 'NON_ALLOW_AUTHORIZATION',
  /** The execution's `authorizationReceiptDigest` did not match the referenced authorization. */
  AuthorizationDigestMismatch = 'AUTHORIZATION_DIGEST_MISMATCH',
}

/** A single detected deviation, tied to the execution (and authorization) it concerns. */
export interface AuditViolation {
  readonly type: AuditViolationType;
  readonly executionId?: string;
  readonly authorizationReceiptId?: string;
  readonly detail: string;
}

/** The audit result: validity, how many executions were checked, the violations, and coverage. */
export interface AuditReport {
  readonly valid: boolean;
  readonly executionsChecked: number;
  readonly violations: readonly AuditViolation[];
  /** Fraction of executions with exactly one valid, matching authorization (1.0 = fully mediated). */
  readonly coverage: number;
}

/** Inputs to {@link auditCompleteMediation}. */
export interface AuditInput {
  readonly authorizationReceipts: readonly AuthorizationReceipt[];
  readonly executionReceipts: readonly ExecutionReceipt[];
  /** Trusted gate signer keys: `keyId` → raw Ed25519 public key. */
  readonly trustedAuthKeys: ReadonlyMap<string, Buffer>;
  /** Trusted executor signer keys: `keyId` → raw Ed25519 public key. */
  readonly trustedExecKeys: ReadonlyMap<string, Buffer>;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Audit a set of executions for complete mediation against their authorizations.
 *
 * For each execution receipt it verifies the executor signature, resolves the referenced
 * authorization (exactly one must exist), verifies that authorization (signature, ALLOW verdict,
 * digest link, action match, validity window, policy & evidence commitments), and across the whole
 * set detects authorizations executed more than `maxExecutions` (replay).
 *
 * @param input - The record sets and trusted key registries.
 * @returns An {@link AuditReport}.
 */
export function auditCompleteMediation(input: AuditInput): AuditReport {
  const violations: AuditViolation[] = [];
  const authById = new Map<string, AuthorizationReceipt[]>();
  for (const a of input.authorizationReceipts) {
    (authById.get(a.receiptId) ?? authById.set(a.receiptId, []).get(a.receiptId)!).push(a);
  }
  // Only actual executions are subject to complete mediation. A REJECTED receipt records a refusal
  // *before* execution (the handler never ran and the single-use nonce was never consumed), so it is
  // not a protected execution — auditing it as one would flag a correctly-blocked attack as a
  // violation and let an attacker poison the audit by reporting blocked-attempt receipts. SUCCEEDED /
  // FAILED / PARTIALLY_COMPLETED all consumed the authorization and are audited.
  const executions = input.executionReceipts.filter((e) => e.executionStatus !== ExecutionStatus.Rejected);

  // Count executions per authorization to detect replay (more executions than the slot allows).
  const execCountByAuth = new Map<string, number>();
  for (const e of executions) {
    execCountByAuth.set(e.authorizationReceiptId, (execCountByAuth.get(e.authorizationReceiptId) ?? 0) + 1);
  }

  let clean = 0;
  for (const exec of executions) {
    const before = violations.length;
    const add = (type: AuditViolationType, detail: string): void => {
      violations.push({ type, executionId: exec.executionId, authorizationReceiptId: exec.authorizationReceiptId, detail });
    };

    const execKey = input.trustedExecKeys.get(exec.keyId);
    if (!execKey || !verifyExecutionReceiptSignature(exec, execKey)) {
      add(AuditViolationType.InvalidExecutionSignature, `execution ${exec.executionId} has an invalid/untrusted signature`);
    }

    const auths = authById.get(exec.authorizationReceiptId) ?? [];
    if (auths.length === 0) {
      add(AuditViolationType.ExecutionWithoutAuthorization, `no authorization ${exec.authorizationReceiptId}`);
    } else if (auths.length > 1) {
      add(AuditViolationType.MultipleAuthorizations, `${auths.length} authorizations share id ${exec.authorizationReceiptId}`);
    } else {
      const auth = auths[0]!;
      const authKey = input.trustedAuthKeys.get(auth.keyId);
      if (!authKey || !verifyReceiptSignature(auth, authKey)) {
        add(AuditViolationType.InvalidAuthorizationSignature, `authorization ${auth.receiptId} has an invalid/untrusted signature`);
      }
      if (auth.finalVerdict !== Verdict.Allow) {
        add(AuditViolationType.NonAllowAuthorization, `authorization ${auth.receiptId} verdict is ${auth.finalVerdict}`);
      }
      if (authorizationReceiptDigest(auth) !== exec.authorizationReceiptDigest) {
        add(AuditViolationType.AuthorizationDigestMismatch, `execution links a different authorization digest`);
      }
      if (exec.actualActionDigest !== auth.actionDigest) {
        add(AuditViolationType.ActionSubstitution, `executed action digest != authorized action digest`);
      }
      const started = Date.parse(exec.startedAt);
      const issued = Date.parse(auth.issuedAt);
      const expires = Date.parse(auth.expiresAt);
      if (Number.isFinite(started) && Number.isFinite(issued) && Number.isFinite(expires) && (started < issued || started >= expires)) {
        add(AuditViolationType.ExpiredAuthorization, `execution ran outside the authorization validity window`);
      }
      if (!HEX64.test(auth.policyBundleDigest)) add(AuditViolationType.MissingPolicyCommitment, `authorization ${auth.receiptId} lacks a policy commitment`);
      if (!HEX64.test(auth.evidenceDigest)) add(AuditViolationType.MissingEvidenceCommitment, `authorization ${auth.receiptId} lacks an evidence commitment`);
      if ((execCountByAuth.get(auth.receiptId) ?? 0) > auth.maxExecutions) {
        add(AuditViolationType.ReplayedAuthorization, `authorization ${auth.receiptId} executed more than maxExecutions (${auth.maxExecutions})`);
      }
    }

    if (violations.length === before) clean++;
  }

  const executionsChecked = executions.length;
  return {
    valid: violations.length === 0,
    executionsChecked,
    violations,
    coverage: executionsChecked === 0 ? 1 : clean / executionsChecked,
  };
}
