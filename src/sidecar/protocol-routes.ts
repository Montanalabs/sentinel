/**
 * HTTP surface for the adjudication protocol, registered additively onto the sidecar.
 *
 * These `/v1` routes expose the receipt protocol end-to-end without touching the core gate API
 * (`/v1/guard` and friends keep their exact behaviour):
 *
 *   - `POST /v1/adjudications`     run the {@link Adjudicator}; persist + return a receipt on ALLOW
 *   - `POST /v1/receipts/validate` validate a receipt for an execution binding (consumes its nonce)
 *   - `POST /v1/executions`        ingest a signed execution receipt into the audit log
 *   - `POST /v1/receipts/revoke`   revoke a receipt id (fail-closed at the next validation)
 *   - `GET  /v1/audit/verify`      complete-mediation audit over the persisted receipts/executions
 *   - `GET  /v1/audit/coverage`    just the coverage fraction of that audit
 *
 * The routes are wired only when {@link SidecarDeps.protocol} is provided, so a deployment that does
 * not use the protocol pays nothing for it. Validation failures return a typed `{ ok:false, error }`
 * body with HTTP 200 (a validation *result*, not a transport error); malformed requests return 400.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Verdict } from '../core/types.js';
import type { Action, AgentContext, GuardRequest } from '../core/types.js';
import type { Adjudicator, AdjudicationRequest } from '../protocol/adjudicator.js';
import type { ReceiptValidator } from '../protocol/receipt-validator.js';
import type { RevocationStore } from '../protocol/revocation-store.js';
import { Ownership, Boundary, type VerifierIndependenceProfile } from '../protocol/verifier-independence.js';
import { auditCompleteMediation } from '../protocol/auditor.js';
import { toCanonicalAction, type CanonicalAction } from '../protocol/canonical-action.js';
import { ProtocolError } from '../protocol/errors.js';
import type { EvidenceItem } from '../protocol/evidence-commitment.js';
import type { ModelSignal } from '../protocol/adjudication.js';
import { verifyExecutionReceiptSignature, type ExecutionReceipt } from '../protocol/execution-receipt.js';
import type { AuthorizationReceipt } from '../protocol/authorization-receipt.js';
import type { ReceiptStore } from '../store/receipt-store.js';
import type { ExecutionReceiptStore } from '../store/execution-store.js';

/** Collaborators the protocol routes depend on. Supplied via {@link SidecarDeps.protocol}. */
export interface ProtocolDeps {
  /** Runs the fail-safe rule and issues receipts on ALLOW. */
  readonly adjudicator: Adjudicator;
  /** Validates a receipt and consumes its single-use nonce. */
  readonly validator: ReceiptValidator;
  /** Durable store of issued authorization receipts. */
  readonly receipts: ReceiptStore;
  /** Durable store of reported execution receipts. */
  readonly executions: ExecutionReceiptStore;
  /** Revocation list the validator consults. */
  readonly revocations: RevocationStore;
  /** Trusted gate signer keys (`keyId` → raw Ed25519 public key) for the audit. */
  readonly trustedAuthKeys: ReadonlyMap<string, Buffer>;
  /** Trusted executor signer keys (`keyId` → raw Ed25519 public key) for ingest + audit. */
  readonly trustedExecKeys: ReadonlyMap<string, Buffer>;
}

const HEX64 = z.string().regex(/^[0-9a-f]{64}$/, 'must be a 64-char hex digest');
const RECORD = z.record(z.unknown());

const CanonicalActionSchema = z.object({
  actionType: z.string(),
  targetService: z.string(),
  operation: z.string(),
  parameters: RECORD,
  actorId: z.string(),
  tenant: z.string().optional(),
  scope: z.string().optional(),
  environment: z.string().optional(),
  attributes: RECORD.optional(),
});

const PolicyManifestSchema = z.object({
  policyVersion: z.string(),
  checkerVersions: z.record(z.string()),
  config: RECORD,
});

const EvidenceItemSchema = z.object({
  sourceId: z.string(),
  sourceType: z.string(),
  queryDigest: z.string(),
  responseDigest: z.string(),
  retrievedAt: z.string(),
  freshnessLimit: z.string().optional(),
  sourceSignature: z.string().optional(),
  transformationDigest: z.string().optional(),
  trustLevel: z.string(),
  availabilityStatus: z.string(),
});

const ModelSignalSchema = z.object({ verdict: z.nativeEnum(Verdict), confidence: z.number().optional() });

const IndependenceSchema = z.object({
  actorProvider: z.string().optional(),
  actorModel: z.string().optional(),
  verifierProvider: z.string(),
  verifierModel: z.string().optional(),
  sameModelFamily: z.boolean().optional(),
  promptOwnedBy: z.nativeEnum(Ownership),
  policyOwnedBy: z.nativeEnum(Ownership),
  contextConstructedBy: z.nativeEnum(Ownership),
  deploymentBoundary: z.nativeEnum(Boundary),
  credentialBoundary: z.nativeEnum(Boundary),
});

const ActionSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: RECORD,
  meta: RECORD.optional(),
});
const ContextSchema = z.object({
  runId: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  actor: z.object({ id: z.string(), roles: z.array(z.string()).optional() }).optional(),
  tenant: z.string().optional(),
});
const GuardSchema = z.object({ action: ActionSchema, context: ContextSchema, policy: z.string() });

const AdjudicationBody = z.object({
  guard: GuardSchema,
  action: CanonicalActionSchema,
  contextDigest: HEX64,
  policy: PolicyManifestSchema,
  evidence: z.array(EvidenceItemSchema),
  model: ModelSignalSchema.optional(),
  independence: IndependenceSchema.optional(),
  humanApprovalReference: z.string().optional(),
  receiptTtlMs: z.number().int().positive().optional(),
  maxExecutions: z.number().int().positive().optional(),
});

// The receipt is re-verified structurally and cryptographically by the validator/auditor, so the
// schema only needs to admit the shape; it never establishes trust on its own.
const ReceiptSchema = z.object({
  receiptId: z.string(),
  protocolVersion: z.string(),
  actionDigest: z.string(),
  contextDigest: z.string(),
  policyBundleDigest: z.string(),
  policyVersion: z.string(),
  evidenceDigest: z.string(),
  deterministicVerdict: z.nativeEnum(Verdict),
  modelVerdict: z.nativeEnum(Verdict).optional(),
  finalVerdict: z.nativeEnum(Verdict),
  humanApprovalReference: z.string().optional(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  nonce: z.string(),
  maxExecutions: z.number(),
  issuer: z.string(),
  keyId: z.string(),
  signature: z.string(),
});

const ValidateBody = z.object({
  receipt: ReceiptSchema,
  binding: z.object({
    actionDigest: HEX64,
    contextDigest: HEX64,
    expectedPolicyBundleDigest: HEX64.optional(),
    requireHumanApproval: z.boolean().optional(),
  }),
});

const ExecutionReceiptSchema = z.object({
  executionId: z.string(),
  authorizationReceiptId: z.string(),
  authorizationReceiptDigest: z.string(),
  actualActionDigest: z.string(),
  executorIdentity: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  resultDigest: z.string(),
  executionStatus: z.string(),
  externalReference: z.string().optional(),
  keyId: z.string(),
  signature: z.string(),
});

const RevokeBody = z.object({ receiptId: z.string(), reason: z.string().optional() });

function sendError(reply: FastifyReply, status: number, message: string, details?: unknown): FastifyReply {
  return reply.code(status).send(details !== undefined ? { error: message, details } : { error: message });
}

// The helpers below rebuild domain objects with conditional spreads, dropping the `| undefined`
// optionals that zod inference carries (which exactOptionalPropertyTypes rejects).

function toGuardRequest(g: z.infer<typeof GuardSchema>): GuardRequest {
  const action: Action = { id: g.action.id, type: g.action.type, payload: g.action.payload, ...(g.action.meta ? { meta: g.action.meta } : {}) };
  const context: AgentContext = {
    runId: g.context.runId,
    ...(g.context.provider ? { provider: g.context.provider } : {}),
    ...(g.context.model ? { model: g.context.model } : {}),
    ...(g.context.tenant ? { tenant: g.context.tenant } : {}),
    ...(g.context.actor ? { actor: { id: g.context.actor.id, ...(g.context.actor.roles ? { roles: g.context.actor.roles } : {}) } } : {}),
  };
  return { action, context, policy: g.policy };
}

function toEvidence(i: z.infer<typeof EvidenceItemSchema>): EvidenceItem {
  return {
    sourceId: i.sourceId,
    sourceType: i.sourceType,
    queryDigest: i.queryDigest,
    responseDigest: i.responseDigest,
    retrievedAt: i.retrievedAt,
    trustLevel: i.trustLevel,
    availabilityStatus: i.availabilityStatus,
    ...(i.freshnessLimit !== undefined ? { freshnessLimit: i.freshnessLimit } : {}),
    ...(i.sourceSignature !== undefined ? { sourceSignature: i.sourceSignature } : {}),
    ...(i.transformationDigest !== undefined ? { transformationDigest: i.transformationDigest } : {}),
  };
}

function toModelSignal(m: z.infer<typeof ModelSignalSchema>): ModelSignal {
  return { verdict: m.verdict, ...(m.confidence !== undefined ? { confidence: m.confidence } : {}) };
}

function toIndependence(p: z.infer<typeof IndependenceSchema>): VerifierIndependenceProfile {
  return {
    verifierProvider: p.verifierProvider,
    promptOwnedBy: p.promptOwnedBy,
    policyOwnedBy: p.policyOwnedBy,
    contextConstructedBy: p.contextConstructedBy,
    deploymentBoundary: p.deploymentBoundary,
    credentialBoundary: p.credentialBoundary,
    ...(p.actorProvider !== undefined ? { actorProvider: p.actorProvider } : {}),
    ...(p.actorModel !== undefined ? { actorModel: p.actorModel } : {}),
    ...(p.verifierModel !== undefined ? { verifierModel: p.verifierModel } : {}),
    ...(p.sameModelFamily !== undefined ? { sameModelFamily: p.sameModelFamily } : {}),
  };
}

/**
 * Register the adjudication-protocol routes onto an existing Fastify app.
 *
 * @param app - The sidecar Fastify instance (already built; routes are added in place).
 * @param deps - The protocol collaborators; see {@link ProtocolDeps}.
 */
export function registerProtocolRoutes(app: FastifyInstance, deps: ProtocolDeps): void {
  app.post('/v1/adjudications', async (req, reply) => {
    const parsed = AdjudicationBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid adjudication request', parsed.error.issues);
    const data = parsed.data;

    let action;
    try {
      // Cast past the `| undefined` zod optionals; toCanonicalAction re-validates and normalizes.
      action = toCanonicalAction(data.action as CanonicalAction); // also rejects non-deterministic params
    } catch (err) {
      if (err instanceof ProtocolError) return sendError(reply, 400, 'non-canonical action', err.message);
      throw err;
    }

    const request: AdjudicationRequest = {
      guard: toGuardRequest(data.guard),
      action,
      contextDigest: data.contextDigest,
      policy: data.policy,
      evidence: data.evidence.map(toEvidence),
      ...(data.model ? { model: toModelSignal(data.model) } : {}),
      ...(data.independence ? { independence: toIndependence(data.independence) } : {}),
      ...(data.humanApprovalReference !== undefined ? { humanApprovalReference: data.humanApprovalReference } : {}),
      ...(data.receiptTtlMs !== undefined ? { receiptTtlMs: data.receiptTtlMs } : {}),
      ...(data.maxExecutions !== undefined ? { maxExecutions: data.maxExecutions } : {}),
    };

    const result = await deps.adjudicator.adjudicate(request);
    if (result.receipt) await deps.receipts.put(result.receipt);
    return reply.send({
      finalVerdict: result.adjudication.finalVerdict,
      adjudication: result.adjudication,
      policy: result.policy,
      evidence: result.evidence,
      independenceWarnings: result.independenceWarnings,
      recordId: result.decision.recordId,
      ...(result.receipt ? { receipt: result.receipt } : {}),
    });
  });

  app.post('/v1/receipts/validate', async (req, reply) => {
    const parsed = ValidateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid validation request', parsed.error.issues);
    const { receipt, binding } = parsed.data;
    const result = await deps.validator.validate(receipt as AuthorizationReceipt, {
      actionDigest: binding.actionDigest,
      contextDigest: binding.contextDigest,
      ...(binding.expectedPolicyBundleDigest !== undefined ? { expectedPolicyBundleDigest: binding.expectedPolicyBundleDigest } : {}),
      ...(binding.requireHumanApproval !== undefined ? { requireHumanApproval: binding.requireHumanApproval } : {}),
    });
    // A validation result (including a typed failure) is a successful 200 response.
    return reply.send(
      result.ok ? { ok: true, executionCount: result.executionCount } : { ok: false, error: { code: result.error.code, message: result.error.message } },
    );
  });

  app.post('/v1/executions', async (req, reply) => {
    const parsed = ExecutionReceiptSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid execution receipt', parsed.error.issues);
    const receipt = parsed.data as ExecutionReceipt;
    // Reject at ingest if the executor signature is untrusted/invalid, so the audit log only holds
    // attributable execution receipts (the audit re-verifies regardless).
    const key = deps.trustedExecKeys.get(receipt.keyId);
    if (!key || !verifyExecutionReceiptSignature(receipt, key)) {
      return sendError(reply, 400, 'untrusted or invalid execution receipt signature');
    }
    await deps.executions.put(receipt);
    return reply.send({ stored: true, executionId: receipt.executionId });
  });

  app.post('/v1/receipts/revoke', async (req, reply) => {
    const parsed = RevokeBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid revoke request', parsed.error.issues);
    await deps.revocations.revoke(parsed.data.receiptId);
    return reply.send({ revoked: true, receiptId: parsed.data.receiptId });
  });

  const runAudit = async () =>
    auditCompleteMediation({
      authorizationReceipts: await deps.receipts.list(),
      executionReceipts: await deps.executions.list(),
      trustedAuthKeys: deps.trustedAuthKeys,
      trustedExecKeys: deps.trustedExecKeys,
    });

  app.get('/v1/audit/verify', async () => runAudit());
  app.get('/v1/audit/coverage', async () => {
    const report = await runAudit();
    return { valid: report.valid, executionsChecked: report.executionsChecked, coverage: report.coverage };
  });
}
