/**
 * Sentinel core domain types.
 *
 * The model proposes an {@link Action}; Sentinel runs {@link Check}s and returns a
 * {@link Verdict} with a signed {@link ProvenanceRecord}.
 */

/**
 * The terminal outcome the gate returns for a proposed {@link Action}.
 *
 * Aggregated across all {@link CheckResult} votes with precedence `BLOCK > ESCALATE > ALLOW`,
 * so any check can veto. Use {@link isAllow}, {@link isBlock}, and {@link isEscalate} to branch.
 */
export enum Verdict {
  Allow = 'ALLOW',
  Block = 'BLOCK',
  Escalate = 'ESCALATE',
}

/**
 * The high-value action types Sentinel ships first-class support for.
 *
 * This is a guidance set, not a closed enum: it powers editor autocompletion while
 * {@link ActionType} still accepts any string so callers can model their own actions.
 */
export type KnownActionType =
  | 'payment'
  | 'db_write'
  | 'email'
  | 'ticket_close'
  | 'record_update'
  | 'trade';

/**
 * The discriminator carried by every {@link Action}.
 *
 * Widens {@link KnownActionType} with an arbitrary `string` (via the `string & {}`
 * trick) so the well-known names autocomplete without forbidding bespoke types.
 */
export type ActionType = KnownActionType | (string & {});

/**
 * A consequential, checkable action an agent proposes to take.
 *
 * The gate's unit of work: every {@link GuardRequest} carries exactly one, and the
 * {@link Verdict} it earns is recorded against its {@link Action.id}. `payload` is the
 * structured, schema-checkable body (e.g. {amount, from, to}) that {@link CheckResult}s inspect.
 *
 * @see {@link ActionType} for the discriminator.
 */
export interface Action {
  /** Stable id for this proposed action (caller-supplied or generated). */
  readonly id: string;
  readonly type: ActionType;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Optional free-form metadata (idempotency keys, source system, etc.). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * A single model/tool step in the agent's reasoning, captured for provenance.
 *
 * Steps are recorded in order on {@link AgentContext.trace} so an audit can replay why
 * the agent produced a given {@link Action}.
 */
export interface TraceStep {
  readonly kind: 'model' | 'tool' | 'message';
  readonly name?: string;
  readonly content?: unknown;
}

/**
 * The agent-run context behind a proposed {@link Action} — who acted, with which model,
 * and the {@link TraceStep} sequence that led to it.
 *
 * Travels on every {@link GuardRequest}; `actor` feeds role-based approval routing and
 * `tenant` scopes the decision to a workspace.
 */
export interface AgentContext {
  /** Correlates all actions within one agent run. */
  readonly runId: string;
  readonly provider?: string;
  readonly model?: string;
  /** Optional ordered trace of the steps that produced the action. */
  readonly trace?: readonly TraceStep[];
  /** Identity acting (used for role-based approval routing). */
  readonly actor?: { readonly id: string; readonly roles?: readonly string[] };
  /** Tenant/workspace scoping. */
  readonly tenant?: string;
}

/**
 * Whether a {@link Check} could reach a conclusion, independent of its {@link Verdict}.
 *
 * `inconclusive` signals the check ran but lacked the ground truth to decide (e.g. an
 * unreachable reconciliation source), which the engine treats as fail-safe rather than a pass.
 */
export enum CheckOutcome {
  Pass = 'pass',
  Fail = 'fail',
  Inconclusive = 'inconclusive',
}

/**
 * The vote one check casts over a proposed {@link Action}.
 *
 * Pairs an {@link CheckOutcome} (could it decide?) with the {@link Verdict} it argues for;
 * the engine aggregates many of these into the single {@link GuardDecision.verdict}.
 */
export interface CheckResult {
  readonly check: string;
  readonly outcome: CheckOutcome;
  /** The verdict this check argues for (default ALLOW on pass, BLOCK on fail). */
  readonly verdict: Verdict;
  readonly reason?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly latencyMs?: number;
}

/**
 * The unit of work the engine evaluates: an {@link Action} plus the {@link AgentContext}
 * that produced it, checked against a named policy pack.
 *
 * Answered with a {@link GuardDecision}.
 */
export interface GuardRequest {
  readonly action: Action;
  readonly context: AgentContext;
  /** Reference to the policy pack/bundle to evaluate against. */
  readonly policy: string;
}

/**
 * The engine's answer to a {@link GuardRequest}: the aggregated {@link Verdict}, the
 * {@link CheckResult}s behind it, and the id of the {@link ProvenanceRecord} written for audit.
 *
 * `escalationId` is populated only when `verdict` is `ESCALATE`, pointing at the human review.
 */
export interface GuardDecision {
  readonly verdict: Verdict;
  readonly recordId: string;
  readonly checks: readonly CheckResult[];
  readonly reason?: string;
  /** Present when verdict is ESCALATE: where the human review landed. */
  readonly escalationId?: string;
}

/**
 * Whether a {@link Verdict} permits the action to proceed.
 *
 * @param v - The verdict to test.
 * @returns `true` only for `ALLOW`.
 */
export const isAllow = (v: Verdict): boolean => v === Verdict.Allow;

/**
 * Whether a {@link Verdict} forbids the action outright.
 *
 * @param v - The verdict to test.
 * @returns `true` only for `BLOCK`.
 */
export const isBlock = (v: Verdict): boolean => v === Verdict.Block;

/**
 * Whether a {@link Verdict} defers the action to human review.
 *
 * @param v - The verdict to test.
 * @returns `true` only for `ESCALATE`.
 */
export const isEscalate = (v: Verdict): boolean => v === Verdict.Escalate;
