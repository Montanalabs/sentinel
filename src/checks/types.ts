/**
 * Core abstractions shared by every check in the checks module.
 *
 * Defines the {@link Check} contract the verdict engine consumes, the
 * {@link CheckInput} every check evaluates, and the {@link CheckTier} that
 * decides whether a check runs in the fast inline budget or the slow parallel
 * tier. Every concrete check ({@link DataBoundaryCheck}, {@link PolicyCheck},
 * {@link SchemaCheck}, {@link NumericReconcileCheck}, {@link PredicateCheck})
 * implements {@link Check} and depends only on the types declared here.
 */

import type { Action, AgentContext, CheckResult } from '../core/types.js';

/**
 * Latency class of a {@link Check}.
 *
 * `fast` checks run inline within the request's synchronous latency budget;
 * `slow` checks (external lookups, model calls) run in parallel under a deadline
 * so a single slow collaborator cannot stall the gate.
 */
export enum CheckTier {
  Fast = 'fast',
  Slow = 'slow',
}

/**
 * The immutable evaluation context handed to every {@link Check}.
 *
 * Bundles the proposed {@link Action} with the {@link AgentContext} that produced
 * it, so checks can reason over both the payload and the agent run (provider,
 * actor, trace) without reaching outside the call.
 */
export interface CheckInput {
  readonly action: Action;
  readonly context: AgentContext;
}

/**
 * A single verification unit the verdict engine runs against a proposed action.
 *
 * Each check votes a {@link Verdict} via the {@link CheckResult} it returns; the
 * engine aggregates the votes. `fast` checks run synchronously in the latency
 * budget; `slow` checks (external lookups, model calls) run in parallel with a
 * deadline. Implementations should fail safe — escalate rather than allow — when
 * ground truth is unavailable.
 *
 * @see {@link CheckTier} for the scheduling contract of {@link Check.tier}.
 */
export interface Check {
  /** Stable identifier for this check, surfaced in the {@link CheckResult.check} field. */
  readonly name: string;
  readonly tier: CheckTier;
  /**
   * Evaluate the proposed action and vote a verdict.
   *
   * @param input - The action and agent context to evaluate; see {@link CheckInput}.
   * @returns The check's {@link CheckResult}, whose `verdict` is this check's vote.
   */
  run(input: CheckInput): Promise<CheckResult>;
}
