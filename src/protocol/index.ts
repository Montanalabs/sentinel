/**
 * Public barrel for the adjudication protocol module.
 *
 * The protocol turns an `ALLOW` adjudication into a signed, single-use, expiring authorization
 * receipt that binds the exact approved action, context, policy, and evidence — so a downstream
 * executor can enforce that every protected execution corresponds to exactly one valid receipt for
 * exactly that action. This barrel re-exports the domain types and services; storage adapters live
 * in the `store` module ({@link NonceStore} and its backends).
 */

export { ProtocolError, ProtocolErrorCode } from './errors.js';
export { toCanonicalAction, actionDigest, type CanonicalAction } from './canonical-action.js';
export {
  PROTOCOL_VERSION,
  receiptSignableBody,
  receiptSigningInput,
  authorizationReceiptDigest,
  verifyReceiptSignature,
  type AuthorizationReceipt,
  type SignableReceipt,
} from './authorization-receipt.js';
export { ReceiptIssuer, type ReceiptInput, type ReceiptIssuerOptions } from './receipt-issuer.js';
export { commitPolicy, policyBundleDigest, type PolicyManifest, type PolicyCommitment } from './policy-commitment.js';
export {
  commitEvidence,
  evidenceMerkleRoot,
  evidenceItemDigest,
  type EvidenceItem,
  type EvidenceCommitment,
} from './evidence-commitment.js';
export {
  ReceiptValidator,
  contextDigestOf,
  type ExecutionBinding,
  type ReceiptValidatorOptions,
  type ValidationResult,
} from './receipt-validator.js';
export { InMemoryRevocationStore, type RevocationStore } from './revocation-store.js';
export {
  ExecutionReceiptSigner,
  ExecutionStatus,
  verifyExecutionReceiptSignature,
  type ExecutionReceipt,
  type ExecutionReceiptInput,
} from './execution-receipt.js';
export { ProtectedExecutor, type ProtectedExecuteArgs, type ProtectedExecutionResult } from './protected-executor.js';
export type { NonceStore, NonceConsumeResult } from '../store/nonce-store.js';
export { merkleRoot } from './merkle.js';
export {
  auditCompleteMediation,
  AuditViolationType,
  type AuditReport,
  type AuditViolation,
  type AuditInput,
} from './auditor.js';
export {
  CheckpointSigner,
  checkpointDigest,
  verifyCheckpointSignature,
  CHECKPOINT_GENESIS,
  type Checkpoint,
  type CheckpointInput,
  type CheckpointPublisher,
} from './checkpoint.js';
export { FileCheckpointPublisher, WebhookCheckpointPublisher } from './checkpoint-publishers.js';
export {
  adjudicate,
  type AdjudicationInputs,
  type AdjudicationDecision,
  type DeterministicSignal,
  type ModelSignal,
  type EvidenceSignal,
} from './adjudication.js';
export {
  assessIndependence,
  isVerifierIndependent,
  Ownership,
  Boundary,
  IndependenceWarningCode,
  type VerifierIndependenceProfile,
  type IndependenceWarning,
} from './verifier-independence.js';
export {
  Adjudicator,
  type AdjudicatorOptions,
  type AdjudicationRequest,
  type AdjudicationResult,
} from './adjudicator.js';
