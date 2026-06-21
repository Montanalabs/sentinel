/**
 * Declarative policy evaluation for the fast check tier.
 *
 * Defines the {@link PolicyCheck}, which interprets a signable
 * {@link PolicyDefinition} (a list of {@link PolicyRule}s over the data-only
 * {@link Condition} language) and votes a {@link Verdict}. This is how
 * Sentinel's policy packs turn declarative rules into gate decisions without any
 * code-execution surface.
 */

import { CheckOutcome, Verdict, type CheckResult } from '../core/types.js';
import { CheckTier, type Check, type CheckInput } from './types.js';
import { evaluateCondition, type Condition, type Scope } from './condition.js';

/**
 * The decision a matching {@link PolicyRule} contributes.
 *
 * Maps onto a {@link Verdict}: `allow` -> ALLOW, `block` -> BLOCK,
 * `require_approval` -> ESCALATE.
 */
export enum RuleEffect {
  Allow = 'allow',
  Block = 'block',
  RequireApproval = 'require_approval',
}

/**
 * One rule in a {@link PolicyDefinition}: a {@link Condition} guard plus the
 * {@link RuleEffect} to apply when it matches.
 *
 * When several rules match, the engine selects the highest-precedence effect
 * (BLOCK > ESCALATE > ALLOW). `approvers` and `reason` are surfaced on the
 * resulting {@link CheckResult}.
 */
export interface PolicyRule {
  id: string;
  when: Condition;
  effect: RuleEffect;
  /** Roles whose human approval is required (effect=require_approval). */
  approvers?: string[];
  reason?: string;
}

/**
 * A named, signable bundle of {@link PolicyRule}s evaluated by {@link PolicyCheck}.
 *
 * `id` namespaces the check (its name is `policy:<id>`). `defaultEffect` decides
 * the verdict when no rule matches, defaulting to `allow`.
 */
export interface PolicyDefinition {
  id: string;
  rules: PolicyRule[];
  /** Effect when no rule matches. Default `allow`. */
  defaultEffect?: RuleEffect.Allow | RuleEffect.Block;
}

const EFFECT_VERDICT: Record<RuleEffect, Verdict> = {
  [RuleEffect.Allow]: Verdict.Allow,
  [RuleEffect.Block]: Verdict.Block,
  [RuleEffect.RequireApproval]: Verdict.Escalate,
};

const VERDICT_OUTCOME = {
  [Verdict.Allow]: CheckOutcome.Pass,
  [Verdict.Block]: CheckOutcome.Fail,
  [Verdict.Escalate]: CheckOutcome.Inconclusive,
} as const;

// Higher rank wins when multiple rules match.
const RANK: Record<Verdict, number> = { [Verdict.Allow]: 0, [Verdict.Escalate]: 1, [Verdict.Block]: 2 };

/**
 * Evaluates a declarative policy bundle against the proposed action.
 *
 * A fast-tier {@link Check} that matches every {@link PolicyRule} whose
 * {@link Condition} holds, then resolves competing matches by precedence
 * (BLOCK > ESCALATE > ALLOW). With no match it applies the bundle's
 * `defaultEffect`. Evaluation is pure data interpretation — no I/O, no code
 * execution.
 */
export class PolicyCheck implements Check {
  readonly name: string;
  readonly tier: CheckTier = CheckTier.Fast;

  /**
   * @param def - The policy bundle to interpret; its `id` becomes part of the
   *   check name (`policy:<id>`). See {@link PolicyDefinition}.
   */
  constructor(private readonly def: PolicyDefinition) {
    this.name = `policy:${def.id}`;
  }

  /**
   * Match the action against the bundle's rules and vote a verdict.
   *
   * @param input - The proposed action and agent context; see {@link CheckInput}.
   * @returns A {@link CheckResult} whose verdict is the highest-precedence
   *   matching {@link RuleEffect} (or the `defaultEffect` when nothing matches),
   *   with the ids of all matched rules and any required `approvers` in `details`.
   */
  async run(input: CheckInput): Promise<CheckResult> {
    const scope: Scope = {
      action: { type: input.action.type, payload: input.action.payload, meta: input.action.meta ?? {} },
      context: input.context,
    };

    const matched = this.def.rules.filter((r) => evaluateCondition(r.when, scope));

    let decided: PolicyRule | undefined;
    for (const r of matched) {
      if (!decided || RANK[EFFECT_VERDICT[r.effect]] > RANK[EFFECT_VERDICT[decided.effect]]) {
        decided = r;
      }
    }

    let verdict: Verdict;
    let reason: string | undefined;
    const approvers = decided?.approvers;
    if (decided) {
      verdict = EFFECT_VERDICT[decided.effect];
      reason = decided.reason;
    } else {
      verdict = this.def.defaultEffect === RuleEffect.Block ? Verdict.Block : Verdict.Allow;
      reason = verdict === Verdict.Block ? 'denied by default (no matching allow rule)' : undefined;
    }

    return {
      check: this.name,
      outcome: VERDICT_OUTCOME[verdict],
      verdict,
      ...(reason ? { reason } : {}),
      details: {
        matchedRules: matched.map((r) => r.id),
        ...(approvers ? { approvers } : {}),
      },
    };
  }
}
