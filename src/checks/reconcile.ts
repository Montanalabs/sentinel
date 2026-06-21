/**
 * Numeric reconciliation against an independent source of truth (slow tier).
 *
 * Defines {@link NumericReconcileCheck}, a slow-tier {@link Check} that compares a
 * numeric field of the action against a value fetched live from an external
 * authority (e.g. a ledger balance) using a {@link Relation}. It encodes the
 * fail-safe rule that a missing source of truth ESCALATEs rather than ALLOWs,
 * and is configured by a {@link ReconcileSpec}.
 */

import type { CheckResult } from '../core/types.js';
import { CheckOutcome, Verdict } from '../core/types.js';
import type { Check, CheckInput } from './types.js';
import { CheckTier } from './types.js';
import { resolveField } from './condition.js';

/** Numeric comparison applied between the action's value and the source of truth. */
export enum Relation {
  Lte = 'lte',
  Lt = 'lt',
  Eq = 'eq',
  Gte = 'gte',
  Gt = 'gt',
}

/**
 * Configuration for a {@link NumericReconcileCheck}: which field to read, the
 * {@link Relation} it must satisfy, and how to fetch the source-of-truth value.
 *
 * `source` performs the live lookup and must resolve `undefined` to signal the
 * source of truth is unavailable (which drives a fail-safe ESCALATE rather than
 * an error or an ALLOW). `field` becomes part of the check name
 * (`reconcile:<field>`).
 */
export interface ReconcileSpec {
  /** Dotted path to the numeric value being checked, e.g. `action.payload.amount`. */
  field: string;
  relation: Relation;
  /** Fetch the source-of-truth value (e.g. ledger balance). undefined => unavailable. */
  source: (input: CheckInput) => Promise<number | undefined>;
  reason?: string;
}

const RELATIONS: Record<Relation, (a: number, b: number) => boolean> = {
  [Relation.Lte]: (a, b) => a <= b,
  [Relation.Lt]: (a, b) => a < b,
  [Relation.Eq]: (a, b) => a === b,
  [Relation.Gte]: (a, b) => a >= b,
  [Relation.Gt]: (a, b) => a > b,
};

/**
 * Reconciles a numeric field against an independently-fetched source-of-truth.
 *
 * A slow-tier {@link Check}: it resolves the configured field, fetches the
 * authoritative value via the {@link ReconcileSpec.source} callback, and BLOCKs
 * when the {@link Relation} fails. When the source is unavailable (resolves
 * `undefined`) it ESCALATES (fail-safe) rather than allowing.
 */
export class NumericReconcileCheck implements Check {
  readonly name: string;
  readonly tier: CheckTier = CheckTier.Slow;

  /**
   * @param spec - The field, relation, and source-of-truth fetcher; see
   *   {@link ReconcileSpec}. `spec.field` becomes part of the check name.
   */
  constructor(private readonly spec: ReconcileSpec) {
    this.name = `reconcile:${spec.field}`;
  }

  /**
   * Fetch the source of truth and reconcile the action's numeric field against it.
   *
   * @param input - The proposed action and agent context; see {@link CheckInput}.
   * @returns BLOCK if the field is non-numeric or the relation fails; ESCALATE if
   *   the source of truth is unavailable; ALLOW when the relation holds. See
   *   {@link CheckResult}.
   * @throws Propagates any error thrown or rejected by the {@link ReconcileSpec.source}
   *   callback; callers must handle a failing source-of-truth lookup.
   */
  async run(input: CheckInput): Promise<CheckResult> {
    const scope = { action: { type: input.action.type, payload: input.action.payload }, context: input.context };
    const value = resolveField(this.spec.field, scope);
    if (typeof value !== 'number') {
      return {
        check: this.name,
        outcome: CheckOutcome.Fail,
        verdict: Verdict.Block,
        reason: `reconcile field ${this.spec.field} is not numeric`,
      };
    }

    const truth = await this.spec.source(input);
    if (truth === undefined) {
      return {
        check: this.name,
        outcome: CheckOutcome.Inconclusive,
        verdict: Verdict.Escalate,
        reason: 'source-of-truth unavailable; escalating for manual reconciliation',
      };
    }

    const ok = RELATIONS[this.spec.relation](value, truth);
    const details = { field: this.spec.field, value, truth, relation: this.spec.relation };
    if (ok) return { check: this.name, outcome: CheckOutcome.Pass, verdict: Verdict.Allow, details };
    return {
      check: this.name,
      outcome: CheckOutcome.Fail,
      verdict: Verdict.Block,
      reason: this.spec.reason ?? `reconcile failed: ${value} ${this.spec.relation} ${truth} is false`,
      details,
    };
  }
}
