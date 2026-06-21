/**
 * The fail-safe adjudication rule (protocol §10) — the decision core the receipt protocol formalizes.
 *
 * {@link adjudicate} is a *pure* function from a set of signals (deterministic checks, evidence
 * availability, an optional independent-model second opinion) to a single {@link Verdict}. It applies
 * a fixed precedence ordered by **outcome severity** — every `BLOCK` condition is considered before
 * any `ESCALATE` condition — which it can never be reconfigured to violate:
 *
 * 1. a *hard* deterministic `BLOCK` is absolute and cannot be overridden by any model;
 * 2. an independent-model `BLOCK` under a block policy also blocks;
 * 3. otherwise, required-but-unavailable evidence forces `ESCALATE` (never silently `ALLOW`);
 * 4. otherwise, a model `BLOCK` under an escalate policy escalates to a human;
 * 5. otherwise, a model below its confidence threshold forces `ESCALATE`;
 * 6. otherwise, `ALLOW` *only* when every signal independently allows;
 * 7. otherwise `ESCALATE` — the fail-safe default for any unresolved state.
 *
 * Ordering by severity (blocks before escalations) rather than by signal type is deliberate: it is
 * what makes the rule **monotone** — worsening any single signal can never yield a *more permissive*
 * outcome. (The literal protocol §10 pseudocode interleaves evidence-availability between the hard-
 * and model-block rules; doing so would let unavailable evidence downgrade a model `BLOCK` to
 * `ESCALATE`, i.e. make a worse input more permissive. This severity ordering refines that while
 * preserving the same fail-safe-never-`ALLOW` guarantee.)
 *
 * Keeping this a pure, total function is deliberate: the safety invariants it must satisfy (a hard
 * block is un-overridable; missing evidence never yields `ALLOW`; worsening any signal never makes
 * the outcome more permissive; `ALLOW` requires unanimous allow) are property-tested directly against
 * it, independent of the engine, the issuer, or any I/O.
 */

import { Verdict } from '../core/types.js';

/** Restrictiveness rank; a higher rank wins when aggregating, mirroring the engine's `BLOCK > ESCALATE > ALLOW`. */
const RANK: Record<Verdict, number> = { [Verdict.Allow]: 0, [Verdict.Escalate]: 1, [Verdict.Block]: 2 };

/**
 * One deterministic check's vote, as the adjudicator sees it.
 *
 * `hard` marks a check whose `BLOCK` is absolute (e.g. sanctions, schema-invalid): only a hard block
 * produces a final `BLOCK`. A non-hard (advisory) check that fails cannot force a block, but — being
 * non-`ALLOW` — still prevents `ALLOW`, so it degrades to `ESCALATE`. Checks are hard by default at
 * the mapping layer; advisory checks must opt out explicitly.
 */
export interface DeterministicSignal {
  /** Check name, surfaced in the decision reason. */
  readonly name: string;
  /** The verdict this check argues for. */
  readonly verdict: Verdict;
  /** Whether a `BLOCK` from this check is an un-overridable hard block. */
  readonly hard: boolean;
}

/** The independent model's second opinion, when one was obtained. */
export interface ModelSignal {
  /** The verdict the independent model argues for. */
  readonly verdict: Verdict;
  /** Optional self-reported confidence in `[0, 1]`; gated against the configured threshold. */
  readonly confidence?: number;
}

/** Whether the evidence required by policy was actually usable at decision time. */
export interface EvidenceSignal {
  /** `true` if any required evidence was missing, stale, contradictory, or unavailable. */
  readonly requiredButUnavailable: boolean;
  /** Optional human-readable cause, surfaced in the decision reason. */
  readonly reason?: string;
}

/** The complete signal set {@link adjudicate} decides over. */
export interface AdjudicationInputs {
  /** Deterministic check votes (schema, policy, data-boundary, reconciliation, …). */
  readonly deterministic: readonly DeterministicSignal[];
  /** Availability of the evidence policy required. */
  readonly evidence: EvidenceSignal;
  /** Optional independent-model second opinion. */
  readonly model?: ModelSignal;
  /** Minimum model confidence to accept; below it (or if confidence is absent) the model forces `ESCALATE`. */
  readonly modelConfidenceThreshold?: number;
  /** How to treat a model `BLOCK`: hard `BLOCK` (default) or `ESCALATE` for a human. */
  readonly modelBlockVerdict?: Verdict.Block | Verdict.Escalate;
}

/** The adjudicator's resolved decision, including the component verdicts a receipt records. */
export interface AdjudicationDecision {
  /** Aggregate of the deterministic votes (`BLOCK > ESCALATE > ALLOW`), recorded on the receipt. */
  readonly deterministicVerdict: Verdict;
  /** The independent model's verdict, if one was supplied. */
  readonly modelVerdict?: Verdict;
  /** The final, enforced verdict after applying the §10 precedence. */
  readonly finalVerdict: Verdict;
  /** Which rule fired, for audit and the provenance record. */
  readonly reason: string;
}

/** Aggregate verdicts with `BLOCK > ESCALATE > ALLOW`; an empty set aggregates to `ALLOW`. */
function aggregateVerdict(verdicts: readonly Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((acc, v) => (RANK[v] > RANK[acc] ? v : acc), Verdict.Allow);
}

/**
 * Apply the fail-safe adjudication rule (§10) to a signal set.
 *
 * Total and side-effect-free: every input maps to exactly one {@link AdjudicationDecision}. `ALLOW`
 * is returned only when no hard block fired, required evidence was available, the model (if any) did
 * not block and met its confidence threshold, and *every* signal independently allowed — anything
 * else resolves to `BLOCK` (hard blocks only) or the `ESCALATE` fail-safe.
 *
 * @param inputs - The deterministic, evidence, and model signals; see {@link AdjudicationInputs}.
 * @returns The component and final verdicts with the deciding rule's reason.
 */
export function adjudicate(inputs: AdjudicationInputs): AdjudicationDecision {
  const deterministicVerdict = aggregateVerdict(inputs.deterministic.map((d) => d.verdict));
  const modelVerdict = inputs.model?.verdict;
  const base = { deterministicVerdict, ...(modelVerdict !== undefined ? { modelVerdict } : {}) };
  const decide = (finalVerdict: Verdict, reason: string): AdjudicationDecision => ({ ...base, finalVerdict, reason });
  const modelBlockResolves = inputs.modelBlockVerdict ?? Verdict.Block;

  // --- BLOCK conditions (considered before any escalate condition, so a worse input is never more permissive) ---

  // 1. A hard deterministic block is absolute — no model or evidence state can lift it.
  const hardBlock = inputs.deterministic.find((d) => d.hard && d.verdict === Verdict.Block);
  if (hardBlock) return decide(Verdict.Block, `hard deterministic block: ${hardBlock.name}`);

  // 2. An independent-model block under a block policy also blocks, regardless of evidence state.
  if (modelVerdict === Verdict.Block && modelBlockResolves === Verdict.Block) {
    return decide(Verdict.Block, 'independent model returned BLOCK');
  }

  // --- ESCALATE conditions ---

  // 3. Required evidence missing/stale/contradictory/unavailable — escalate, never silently allow.
  if (inputs.evidence.requiredButUnavailable) {
    return decide(Verdict.Escalate, `required evidence unavailable${inputs.evidence.reason ? `: ${inputs.evidence.reason}` : ''}`);
  }

  // 4. A model block under an escalate policy defers to a human.
  if (modelVerdict === Verdict.Block) {
    return decide(Verdict.Escalate, 'independent model returned BLOCK (escalate policy)');
  }

  // 5. A model present under a configured threshold must clear it; absent/low confidence escalates.
  if (inputs.model && inputs.modelConfidenceThreshold !== undefined) {
    const confidence = inputs.model.confidence;
    if (confidence === undefined || confidence < inputs.modelConfidenceThreshold) {
      return decide(Verdict.Escalate, `model confidence ${confidence ?? 'unknown'} below threshold ${inputs.modelConfidenceThreshold}`);
    }
  }

  // 6. Allow ONLY when every signal independently allows.
  const allDeterministicAllow = inputs.deterministic.every((d) => d.verdict === Verdict.Allow);
  const modelAllows = modelVerdict === undefined || modelVerdict === Verdict.Allow;
  if (allDeterministicAllow && modelAllows) return decide(Verdict.Allow, 'all signals allow');

  // 7. Fail safe: anything unresolved escalates to a human rather than passing.
  return decide(Verdict.Escalate, 'unresolved non-allow signal; escalating (fail-safe)');
}
