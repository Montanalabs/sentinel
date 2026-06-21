/**
 * Data-residency / data-loss guardrail for the fast check tier.
 *
 * Defines the {@link DataBoundaryCheck}, a {@link Check} that blocks
 * consequential actions which would route PII/PHI to an uncleared provider or
 * region. It reuses {@link resolveField} to read configured payload paths and
 * the destination region from the {@link CheckInput}, and is configured by a
 * {@link DataBoundaryPolicy} carried in a signed policy pack.
 */

import { CheckOutcome, Verdict } from '../core/types.js';
import type { CheckResult } from '../core/types.js';
import { CheckTier } from './types.js';
import type { Check, CheckInput } from './types.js';
import { resolveField } from './condition.js';

/**
 * Configuration declaring where PII/PHI lives in an action and which
 * destinations are cleared to receive it.
 *
 * When `allowedProviders` or `allowedRegions` is set and PII is present, any
 * provider/region not on the list is blocked; leaving a list unset disables that
 * dimension of the check. Consumed by {@link DataBoundaryCheck}.
 */
export interface DataBoundaryPolicy {
  /** Dotted payload paths that carry PII/PHI. */
  piiFields: string[];
  /** Providers cleared to receive PII. If set, others are blocked when PII is present. */
  allowedProviders?: string[];
  /** Regions cleared to receive PII. If set, others are blocked when PII is present. */
  allowedRegions?: string[];
  /** Where to read the destination region from. Default `action.meta.region`. */
  regionField?: string;
}

function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

/**
 * Blocks consequential actions that would route PII/PHI outside cleared boundaries.
 *
 * A fast-tier {@link Check}: it scans the configured PII fields and, if any are
 * present, BLOCKs when the action's provider or destination region is not on the
 * cleared list in its {@link DataBoundaryPolicy}. When no PII is present, or all
 * present PII is bound for a cleared destination, it ALLOWs.
 */
export class DataBoundaryCheck implements Check {
  readonly name = 'data-boundary';
  readonly tier: CheckTier = CheckTier.Fast;

  /**
   * @param policy - The PII paths and cleared providers/regions to enforce; see
   *   {@link DataBoundaryPolicy}.
   */
  constructor(private readonly policy: DataBoundaryPolicy) {}

  /**
   * Evaluate the action against the data-boundary policy.
   *
   * Builds an evaluation scope from the action and context, detects which PII
   * fields are populated, and checks the destination provider/region against the
   * cleared lists. Pure data inspection — performs no I/O and never throws.
   *
   * @param input - The proposed action and agent context; see {@link CheckInput}.
   * @returns ALLOW when no PII is present or the destination is cleared; BLOCK
   *   (with the specific violations in `reason` and `details`) otherwise. See
   *   {@link CheckResult}.
   */
  async run(input: CheckInput): Promise<CheckResult> {
    const scope = {
      action: { type: input.action.type, payload: input.action.payload, meta: input.action.meta ?? {} },
      context: input.context,
    };
    const piiPresent = this.policy.piiFields.filter((f) => isPresent(resolveField(f, scope)));

    if (piiPresent.length === 0) {
      return { check: this.name, outcome: CheckOutcome.Pass, verdict: Verdict.Allow };
    }

    const provider = input.context.provider;
    const region = resolveField(this.policy.regionField ?? 'action.meta.region', scope);
    const violations: string[] = [];
    if (this.policy.allowedProviders && (!provider || !this.policy.allowedProviders.includes(provider))) {
      violations.push(`provider "${provider ?? 'unknown'}" not cleared for PII`);
    }
    if (this.policy.allowedRegions && (typeof region !== 'string' || !this.policy.allowedRegions.includes(region))) {
      violations.push(`region "${String(region ?? 'unknown')}" not cleared for PII`);
    }

    const details = { piiPresent, provider: provider ?? null, region: region ?? null };
    if (violations.length > 0) {
      return {
        check: this.name,
        outcome: CheckOutcome.Fail,
        verdict: Verdict.Block,
        reason: `data-boundary violation: ${violations.join('; ')}`,
        details,
      };
    }
    return { check: this.name, outcome: CheckOutcome.Pass, verdict: Verdict.Allow, details };
  }
}
