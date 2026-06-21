/**
 * Adapts a second-opinion {@link Provider} into a slow-tier gate {@link Check}.
 *
 * This is the bridge between the providers module and the checks pipeline: it turns an
 * independent model's {@link SecondOpinionVerdict} into a {@link CheckResult}, mapping agreement
 * to ALLOW, disagreement to ESCALATE, and any provider error to ESCALATE (fail-safe).
 */

import type { CheckResult } from '../core/types.js';
import { CheckOutcome, Verdict } from '../core/types.js';
import type { Check, CheckInput } from '../checks/types.js';
import { CheckTier } from '../checks/types.js';
import type { Provider } from './types.js';

/** Configuration for a {@link SecondOpinionCheck}. */
export interface SecondOpinionOptions {
  /** The independent {@link Provider} consulted for each evaluated action. */
  provider: Provider;
  /** The question to ask the independent model — static string or per-input builder. */
  question: string | ((input: CheckInput) => string);
}

/**
 * Cross-model check: asks an independent provider whether the action is correct.
 * Agreement => ALLOW. Disagreement => ESCALATE (uncertainty, not an outright block).
 * Provider error => ESCALATE (fail-safe), never silently allow.
 */
export class SecondOpinionCheck implements Check {
  /** Check identifier, derived as `second-opinion:<provider.name>`. */
  readonly name: string;
  /** Always `slow`: cross-model calls run in the slow tier of the gate. */
  readonly tier: CheckTier = CheckTier.Slow;

  /**
   * @param opts - The provider and question to consult; see {@link SecondOpinionOptions}.
   */
  constructor(private readonly opts: SecondOpinionOptions) {
    this.name = `second-opinion:${opts.provider.name}`;
  }

  /**
   * Run the cross-model check for one proposed action.
   *
   * Resolves the question (static or per-input), consults the provider, and maps the verdict:
   * agreement yields a passing ALLOW, disagreement an inconclusive ESCALATE. Provider failures
   * are caught and converted into an inconclusive ESCALATE so the gate fails safe rather than
   * silently allowing — this method does not throw.
   *
   * @param input - The {@link CheckInput} carrying the action and agent context.
   * @returns A {@link CheckResult} whose verdict is ALLOW (agreement) or ESCALATE (disagreement
   *   or provider error).
   */
  async run(input: CheckInput): Promise<CheckResult> {
    const question = typeof this.opts.question === 'function' ? this.opts.question(input) : this.opts.question;
    try {
      const v = await this.opts.provider.secondOpinion({ action: input.action, context: input.context, question });
      const details = {
        agree: v.agree,
        ...(v.confidence !== undefined ? { confidence: v.confidence } : {}),
        ...(v.rationale ? { rationale: v.rationale } : {}),
      };
      if (v.agree) return { check: this.name, outcome: CheckOutcome.Pass, verdict: Verdict.Allow, details };
      return {
        check: this.name,
        outcome: CheckOutcome.Inconclusive,
        verdict: Verdict.Escalate,
        reason: `independent model disagrees${v.rationale ? `: ${v.rationale}` : ''}`,
        details,
      };
    } catch (err) {
      return {
        check: this.name,
        outcome: CheckOutcome.Inconclusive,
        verdict: Verdict.Escalate,
        reason: `second-opinion provider error: ${(err as Error).message}`,
      };
    }
  }
}
