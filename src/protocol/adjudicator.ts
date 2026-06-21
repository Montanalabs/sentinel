/**
 * The {@link Adjudicator} — the protocol entry point that turns a guarded decision into an
 * authorization receipt (protocol §10/§13).
 *
 * It *wraps* {@link Engine.guard} rather than replacing it: the engine still runs every check and
 * writes the signed provenance record exactly as before (the `/v1/guard` path is untouched). On top
 * of that, the adjudicator applies the fail-safe {@link adjudicate} rule over the engine's check
 * votes plus evidence availability and an optional independent-model opinion, commits the exact
 * policy and evidence set, surfaces any verifier-independence warnings, and — *only* when the final
 * verdict is `ALLOW` — mints a single-use {@link AuthorizationReceipt} bound to the canonical action,
 * context, policy, and evidence. A `BLOCK`/`ESCALATE` decision yields no receipt, so there is no
 * executable token for an action the gate did not authorize.
 *
 * Because {@link adjudicate} returns `ALLOW` only when every deterministic check allows, the
 * adjudicator is never more permissive than the wrapped engine — it only ever adds constraints
 * (evidence availability, model opinion, confidence threshold, hard/advisory distinction).
 */

import { Verdict } from '../core/types.js';
import type { CheckResult, GuardDecision, GuardRequest } from '../core/types.js';
import type { Engine } from '../engine/engine.js';
import { actionDigest, type CanonicalAction } from './canonical-action.js';
import { adjudicate, type AdjudicationDecision, type DeterministicSignal, type EvidenceSignal, type ModelSignal } from './adjudication.js';
import { commitPolicy, type PolicyCommitment, type PolicyManifest } from './policy-commitment.js';
import { commitEvidence, type EvidenceCommitment, type EvidenceItem } from './evidence-commitment.js';
import { assessIndependence, type IndependenceWarning, type VerifierIndependenceProfile } from './verifier-independence.js';
import type { ReceiptIssuer } from './receipt-issuer.js';
import type { AuthorizationReceipt } from './authorization-receipt.js';

/** Trust level treated as "required" evidence by default (an authoritative source must be reachable). */
const DEFAULT_REQUIRED_TRUST_LEVEL = 'authoritative';
/** Availability status that counts as usable by default. */
const DEFAULT_AVAILABLE_STATUS = 'available';

/** Construction-time dependencies and tuning knobs for an {@link Adjudicator}. */
export interface AdjudicatorOptions {
  /** The verdict engine whose `guard` is wrapped (its provenance record is still written). */
  readonly engine: Pick<Engine, 'guard'>;
  /** Mints receipts for `ALLOW` adjudications. */
  readonly issuer: ReceiptIssuer;
  /** Minimum independent-model confidence to accept; below it (or absent) the model escalates. */
  readonly modelConfidenceThreshold?: number;
  /** How to treat an independent-model `BLOCK`: hard `BLOCK` (default) or `ESCALATE`. */
  readonly modelBlockVerdict?: Verdict.Block | Verdict.Escalate;
  /** Classify a check as a hard block (default: every check is hard). Advisory checks opt out here. */
  readonly classifyHard?: (check: CheckResult) => boolean;
  /** Whether an evidence item is required (default: its `trustLevel` is `authoritative`). */
  readonly isEvidenceRequired?: (item: EvidenceItem) => boolean;
  /** Whether an evidence item is usable (default: its `availabilityStatus` is `available`). */
  readonly isEvidenceAvailable?: (item: EvidenceItem) => boolean;
}

/** One adjudication request: a guard request plus the protocol bindings a receipt must commit to. */
export interface AdjudicationRequest {
  /** The action/context/policy the wrapped {@link Engine.guard} evaluates. */
  readonly guard: GuardRequest;
  /** The protocol-canonical form of the same action; its digest is bound into the receipt. */
  readonly action: CanonicalAction;
  /** Digest of the full context binding the verifier reasoned over. */
  readonly contextDigest: string;
  /** The exact policy decision surface to commit to. */
  readonly policy: PolicyManifest;
  /** The evidence set backing the decision (committed by Merkle root). */
  readonly evidence: readonly EvidenceItem[];
  /** Optional independent-model second opinion. */
  readonly model?: ModelSignal;
  /** Override the computed evidence-availability signal (e.g. when freshness is judged elsewhere). */
  readonly evidenceSignal?: EvidenceSignal;
  /** Reference to a recorded human approval, when policy requires one. */
  readonly humanApprovalReference?: string;
  /** Declared verifier independence; surfaced as warnings on the result. */
  readonly independence?: VerifierIndependenceProfile;
  /** Override the issued receipt's lifetime (ms). */
  readonly receiptTtlMs?: number;
  /** Override the issued receipt's permitted executions (default 1, single-use). */
  readonly maxExecutions?: number;
}

/** The full result of an adjudication: the engine decision, the §10 outcome, commitments, and (on ALLOW) a receipt. */
export interface AdjudicationResult {
  /** The raw engine decision (its provenance record has been written). */
  readonly decision: GuardDecision;
  /** The fail-safe §10 outcome with component and final verdicts. */
  readonly adjudication: AdjudicationDecision;
  /** Commitment to the policy that decided the action. */
  readonly policy: PolicyCommitment;
  /** Commitment to the evidence set. */
  readonly evidence: EvidenceCommitment;
  /** Declared-independence warnings, if a profile was supplied (empty otherwise). */
  readonly independenceWarnings: readonly IndependenceWarning[];
  /** The single-use authorization receipt — present iff `adjudication.finalVerdict` is `ALLOW`. */
  readonly receipt?: AuthorizationReceipt;
}

/**
 * Adjudicates guarded actions and issues authorization receipts for the ones it allows.
 *
 * @see {@link Adjudicator.adjudicate}
 */
export class Adjudicator {
  readonly #engine: Pick<Engine, 'guard'>;
  readonly #issuer: ReceiptIssuer;
  readonly #modelConfidenceThreshold: number | undefined;
  readonly #modelBlockVerdict: Verdict.Block | Verdict.Escalate | undefined;
  readonly #classifyHard: (check: CheckResult) => boolean;
  readonly #isEvidenceRequired: (item: EvidenceItem) => boolean;
  readonly #isEvidenceAvailable: (item: EvidenceItem) => boolean;

  constructor(opts: AdjudicatorOptions) {
    this.#engine = opts.engine;
    this.#issuer = opts.issuer;
    this.#modelConfidenceThreshold = opts.modelConfidenceThreshold;
    this.#modelBlockVerdict = opts.modelBlockVerdict;
    this.#classifyHard = opts.classifyHard ?? (() => true);
    this.#isEvidenceRequired = opts.isEvidenceRequired ?? ((item) => item.trustLevel === DEFAULT_REQUIRED_TRUST_LEVEL);
    this.#isEvidenceAvailable = opts.isEvidenceAvailable ?? ((item) => item.availabilityStatus === DEFAULT_AVAILABLE_STATUS);
  }

  /**
   * Run the wrapped engine, apply the fail-safe §10 rule, and issue a receipt on `ALLOW`.
   *
   * @param request - The guard request plus the protocol bindings to commit to; see {@link AdjudicationRequest}.
   * @returns The engine decision, the §10 adjudication, the policy/evidence commitments,
   *   independence warnings, and — only when allowed — the signed authorization receipt.
   * @throws Propagates any error from the wrapped {@link Engine.guard}. Receipt issuance cannot
   *   throw here: it runs only on an `ALLOW` final verdict.
   */
  async adjudicate(request: AdjudicationRequest): Promise<AdjudicationResult> {
    const decision = await this.#engine.guard(request.guard);

    const deterministic: DeterministicSignal[] = decision.checks.map((c) => ({
      name: c.check,
      verdict: c.verdict,
      hard: this.#classifyHard(c),
    }));
    const evidenceSignal = request.evidenceSignal ?? this.#computeEvidenceSignal(request.evidence);

    const adjudication = adjudicate({
      deterministic,
      evidence: evidenceSignal,
      ...(request.model ? { model: request.model } : {}),
      ...(this.#modelConfidenceThreshold !== undefined ? { modelConfidenceThreshold: this.#modelConfidenceThreshold } : {}),
      ...(this.#modelBlockVerdict !== undefined ? { modelBlockVerdict: this.#modelBlockVerdict } : {}),
    });

    const policy = commitPolicy(request.policy);
    const evidence = commitEvidence(request.evidence);
    const independenceWarnings = request.independence ? assessIndependence(request.independence) : [];

    const result: AdjudicationResult = { decision, adjudication, policy, evidence, independenceWarnings };
    if (adjudication.finalVerdict !== Verdict.Allow) return result;

    const receipt = this.#issuer.issue({
      actionDigest: actionDigest(request.action),
      contextDigest: request.contextDigest,
      policyBundleDigest: policy.policyBundleDigest,
      policyVersion: policy.policyVersion,
      evidenceDigest: evidence.evidenceDigest,
      deterministicVerdict: adjudication.deterministicVerdict,
      ...(adjudication.modelVerdict !== undefined ? { modelVerdict: adjudication.modelVerdict } : {}),
      finalVerdict: Verdict.Allow,
      ...(request.humanApprovalReference !== undefined ? { humanApprovalReference: request.humanApprovalReference } : {}),
      ...(request.receiptTtlMs !== undefined ? { ttlMs: request.receiptTtlMs } : {}),
      ...(request.maxExecutions !== undefined ? { maxExecutions: request.maxExecutions } : {}),
    });
    return { ...result, receipt };
  }

  /** Derive the evidence-availability signal: required if any required source is not usable. */
  #computeEvidenceSignal(items: readonly EvidenceItem[]): EvidenceSignal {
    const unavailable = items.filter((i) => this.#isEvidenceRequired(i) && !this.#isEvidenceAvailable(i));
    if (unavailable.length === 0) return { requiredButUnavailable: false };
    return {
      requiredButUnavailable: true,
      reason: `${unavailable.length} required source(s) unavailable: ${unavailable.map((i) => i.sourceId).join(', ')}`,
    };
  }
}
