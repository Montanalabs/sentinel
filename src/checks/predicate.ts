/**
 * Adapter that turns an arbitrary async predicate into a {@link Check}.
 *
 * Defines {@link PredicateCheck}, the escape hatch policy packs use for bespoke,
 * connector-backed verifications (sanctioned-counterparty lookups, external risk
 * scores) that don't fit the declarative {@link Condition} language. It owns the
 * fail-safe contract: a throwing predicate becomes an ESCALATE, never an ALLOW.
 */

import { CheckOutcome, Verdict } from '../core/types.js';
import type { CheckResult } from '../core/types.js';
import type { Check, CheckInput, CheckTier } from './types.js';

/**
 * The vote a user-supplied predicate returns to {@link PredicateCheck}.
 *
 * The {@link Verdict} is mapped to a {@link CheckResult} outcome; `reason` and
 * `details` are forwarded onto the result when present.
 */
export interface PredicateResult {
  verdict: Verdict;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Construction options for a {@link PredicateCheck}.
 *
 * `name` and `tier` set the resulting check's identity and scheduling tier; the
 * `predicate` performs the actual verification and may do I/O.
 */
export interface PredicateCheckOptions {
  name: string;
  tier: CheckTier;
  predicate: (input: CheckInput) => Promise<PredicateResult>;
}

const VERDICT_OUTCOME = {
  [Verdict.Allow]: CheckOutcome.Pass,
  [Verdict.Block]: CheckOutcome.Fail,
  [Verdict.Escalate]: CheckOutcome.Inconclusive,
} as const;

/**
 * Adapts an arbitrary async predicate into a {@link Check}.
 *
 * Packs use it for bespoke, connector-backed checks (e.g. sanctioned-counterparty
 * lookups). It fails safe: if the wrapped predicate throws, the check votes
 * ESCALATE (inconclusive) rather than letting the error escape — so a flaky
 * collaborator can never silently ALLOW an action.
 */
export class PredicateCheck implements Check {
  readonly name: string;
  readonly tier: CheckTier;

  /**
   * @param opts - The check name, tier, and predicate function; see
   *   {@link PredicateCheckOptions}.
   */
  constructor(private readonly opts: PredicateCheckOptions) {
    this.name = opts.name;
    this.tier = opts.tier;
  }

  /**
   * Run the wrapped predicate and translate its outcome into a {@link CheckResult}.
   *
   * Any error thrown by the predicate is caught and converted into an ESCALATE
   * result, so this method itself never throws (fail-safe).
   *
   * @param input - The proposed action and agent context; see {@link CheckInput}.
   * @returns The {@link CheckResult} mapped from the {@link PredicateResult}, or an
   *   ESCALATE result carrying the error message when the predicate throws.
   */
  async run(input: CheckInput): Promise<CheckResult> {
    try {
      const r = await this.opts.predicate(input);
      return {
        check: this.name,
        outcome: VERDICT_OUTCOME[r.verdict],
        verdict: r.verdict,
        ...(r.reason ? { reason: r.reason } : {}),
        ...(r.details ? { details: r.details } : {}),
      };
    } catch (err) {
      return {
        check: this.name,
        outcome: CheckOutcome.Inconclusive,
        verdict: Verdict.Escalate,
        reason: `${this.name} check errored: ${(err as Error).message}`,
      };
    }
  }
}
