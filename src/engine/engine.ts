/**
 * The Sentinel verdict engine — the decision core of the gate.
 *
 * This file defines {@link Engine}, which evaluates a {@link GuardRequest} by running its
 * policy's {@link Check}s in two tiers (a fast synchronous tier and a deadline-bounded slow
 * tier), aggregates their {@link CheckResult} votes into a single {@link Verdict} with
 * precedence `BLOCK > ESCALATE > ALLOW`, and persists a signed, hash-chained
 * {@link ProvenanceRecord} for every decision via a {@link RecordBuilder} and a
 * {@link ProvenanceStore}. It sits between the policy/check layer and the durable provenance
 * store, and is the symbol re-exported from the module barrel for callers to gate actions.
 */

import { Verdict, CheckOutcome } from '../core/types.js';
import type { CheckResult, GuardDecision, GuardRequest, AgentContext } from '../core/types.js';
import { CheckTier, type Check } from '../checks/types.js';
import { RecordBuilder, GENESIS, type RecordContext, type RecordInput, type ProvenanceRecord } from '../provenance/record.js';
import type { ProvenanceStore } from '../store/types.js';
import { DuplicateRecordError, NonMonotonicSeqError } from '../store/errors.js';

/**
 * Construction-time dependencies and tuning knobs for an {@link Engine}.
 *
 * Bundles the collaborators the engine cannot work without (policy resolution, the
 * {@link RecordBuilder} that signs and chains records, and the backing
 * {@link ProvenanceStore}) together with optional latency- and resilience-related defaults.
 *
 * @see {@link Engine} for how each field is consumed.
 */
export interface EngineOptions {
  /** Resolve the ordered {@link Check}s to run for a policy reference. */
  resolve: (policy: string) => Check[] | Promise<Check[]>;
  /** Signs and hash-chains each decision into a {@link ProvenanceRecord}. */
  builder: RecordBuilder;
  /** Append-only sink the chained {@link ProvenanceRecord}s are persisted to. */
  store: ProvenanceStore;
  /** Deadline for the slow (async) tier, ms. Default 2000. */
  slowBudgetMs?: number;
  /** Verdict assigned to a slow check that misses the budget. Default ESCALATE. */
  onSlowTimeout?: Verdict;
  /** Skip the slow tier when the fast tier already yields BLOCK. Default true. */
  shortCircuitOnBlock?: boolean;
  /** Retries on a provenance append conflict (concurrent writers / HA). Default 3. */
  appendRetries?: number;
}

function isAppendConflict(err: unknown): boolean {
  // A conflict means another writer advanced the chain (duplicate id/seq or a now-stale seq) — both
  // are recoverable by resyncing to tail and retrying. Match the typed store errors, not a message
  // regex, so detection can't silently break if an error's wording changes.
  return err instanceof DuplicateRecordError || err instanceof NonMonotonicSeqError;
}

const RANK: Record<Verdict, number> = { [Verdict.Allow]: 0, [Verdict.Escalate]: 1, [Verdict.Block]: 2 };

function aggregate(results: readonly CheckResult[]): { verdict: Verdict; reason?: string } {
  let verdict: Verdict = Verdict.Allow;
  for (const r of results) if (RANK[r.verdict] > RANK[verdict]) verdict = r.verdict;
  const deciding = results.filter((r) => r.verdict === verdict && verdict !== Verdict.Allow);
  const reason = deciding.map((r) => r.reason).filter(Boolean).join('; ') || undefined;
  return reason ? { verdict, reason } : { verdict };
}

function toRecordContext(ctx: AgentContext): RecordContext {
  return {
    runId: ctx.runId,
    ...(ctx.provider ? { provider: ctx.provider } : {}),
    ...(ctx.model ? { model: ctx.model } : {}),
    ...(ctx.actor ? { actor: ctx.actor } : {}),
  };
}

/** Fail-safe verdict for a check that errors: never ALLOW. */
function checkErrorResult(check: Check, err: unknown, onError: Verdict, latencyMs: number): CheckResult {
  return {
    check: check.name,
    outcome: CheckOutcome.Inconclusive,
    verdict: onError,
    reason: `check errored: ${(err as Error)?.message ?? String(err)}`,
    latencyMs,
  };
}

/**
 * Run a check and time it, converting ANY thrown/rejected error into a fail-safe
 * {@link CheckResult} (voting `onError`, default ESCALATE) instead of propagating.
 *
 * A buggy or throwing check must never crash the decision or — worse — let an action through
 * unchecked. It votes safe and the engine records it like any other check.
 */
async function timed(
  check: Check,
  input: { action: GuardRequest['action']; context: AgentContext },
  onError: Verdict,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await check.run(input);
    return { ...res, latencyMs: Date.now() - start };
  } catch (err) {
    return checkErrorResult(check, err, onError, Date.now() - start);
  }
}

/**
 * Evaluates proposed agent actions and emits a provenance-backed {@link Verdict}.
 *
 * For each {@link GuardRequest} the engine resolves the policy's {@link Check}s, runs the
 * fast tier synchronously, then the slow tier under a deadline (failing safe to the
 * configured timeout verdict — `ESCALATE` by default — rather than `ALLOW`), aggregates the
 * {@link CheckResult} votes with precedence `BLOCK > ESCALATE > ALLOW`, and appends a signed,
 * hash-chained {@link ProvenanceRecord} for every decision. Provenance appends are serialized
 * per engine instance so concurrent calls cannot corrupt the single-builder chain.
 *
 * @see {@link EngineOptions} for the collaborators and tuning knobs supplied at construction.
 */
export class Engine {
  private readonly slowBudgetMs: number;
  private readonly onSlowTimeout: Verdict;
  private readonly shortCircuitOnBlock: boolean;
  private readonly appendRetries: number;

  /**
   * Capture the engine's collaborators and resolve optional tuning knobs to their defaults.
   *
   * @param opts - Dependencies and overrides; see {@link EngineOptions}. Unset numeric/flag
   *   fields fall back to: `slowBudgetMs` 2000ms, `onSlowTimeout` `ESCALATE`,
   *   `shortCircuitOnBlock` `true`, `appendRetries` 3.
   */
  constructor(private readonly opts: EngineOptions) {
    this.slowBudgetMs = opts.slowBudgetMs ?? 2000;
    this.onSlowTimeout = opts.onSlowTimeout ?? Verdict.Escalate;
    this.shortCircuitOnBlock = opts.shortCircuitOnBlock ?? true;
    this.appendRetries = opts.appendRetries ?? 3;
  }

  /**
   * Gate a batch of actions (e.g. a multi-agent fan-out) into one linked provenance chain.
   *
   * Requests are gated sequentially, so the resulting {@link ProvenanceRecord}s form a single
   * contiguous run of the chain in request order. Fails fast: the first request that throws
   * aborts the batch, leaving already-processed requests recorded.
   *
   * @param requests - The actions to gate, evaluated in array order.
   * @returns One {@link GuardDecision} per request, in the same order.
   * @throws Propagates any error from {@link Engine.guard} for the failing request — including
   *   policy-resolution errors, {@link Check} execution errors, and store append failures.
   */
  async guardBatch(requests: readonly GuardRequest[]): Promise<GuardDecision[]> {
    const out: GuardDecision[] = [];
    for (const r of requests) out.push(await this.guard(r));
    return out;
  }

  /**
   * Gate a single proposed action and record the decision.
   *
   * Resolves the request's policy to its {@link Check}s, runs the fast tier; unless a fast
   * `BLOCK` short-circuits it (when `shortCircuitOnBlock` is enabled), runs the slow tier in
   * parallel under the slow budget. Slow checks that miss the deadline vote the configured
   * timeout verdict (`ESCALATE` by default) rather than `ALLOW`, so the engine fails safe.
   * The aggregated {@link Verdict} and all {@link CheckResult}s are then persisted as a signed
   * {@link ProvenanceRecord} before the decision is returned.
   *
   * @param request - The action, agent context, and policy reference to evaluate.
   * @returns The {@link GuardDecision}: aggregated verdict, the id of the appended provenance
   *   record, the per-check results, and the deciding `reason` when the verdict is not `ALLOW`.
   * @throws Propagates any error thrown by the configured `resolve` policy resolver.
   * @throws Propagates the persistence error from {@link ProvenanceStore.append} once append
   *   retries are exhausted. A {@link Check} that throws does NOT propagate — it is converted to a
   *   fail-safe vote (`onSlowTimeout`, default ESCALATE) and recorded like any other result.
   */
  async guard(request: GuardRequest): Promise<GuardDecision> {
    const input = { action: request.action, context: request.context };
    const checks = await this.opts.resolve(request.policy);
    const fast = checks.filter((c) => c.tier === CheckTier.Fast);
    const slow = checks.filter((c) => c.tier === CheckTier.Slow);

    const fastResults = await Promise.all(fast.map((c) => timed(c, input, this.onSlowTimeout)));

    let results = fastResults;
    const fastBlocked = fastResults.some((r) => r.verdict === Verdict.Block);
    if (!(this.shortCircuitOnBlock && fastBlocked) && slow.length > 0) {
      const slowResults = await Promise.all(slow.map((c) => this.runSlow(c, input)));
      results = [...fastResults, ...slowResults];
    }

    // Fail safe: if NO check actually ran, never silently ALLOW. Keyed on the EXECUTED results, so
    // it also covers checks that were resolved but dropped (e.g. an unknown/typo'd tier that lands
    // in neither the fast nor slow partition) — not just an empty resolved set.
    if (results.length === 0) {
      results = [
        {
          check: 'engine.no_checks',
          outcome: CheckOutcome.Inconclusive,
          verdict: Verdict.Escalate,
          reason:
            checks.length === 0
              ? `policy "${request.policy}" resolved to no checks; escalating (fail-safe)`
              : `policy "${request.policy}" resolved ${checks.length} check(s) but none had a runnable tier; escalating (fail-safe)`,
        },
      ];
    }

    const { verdict, reason } = aggregate(results);
    const record = await this.persist({
      ...(request.context.tenant ? { tenant: request.context.tenant } : {}),
      action: request.action,
      context: toRecordContext(request.context),
      checks: results,
      verdict,
      ...(reason ? { reason } : {}),
    });

    return { verdict, recordId: record.id, checks: results, ...(reason ? { reason } : {}) };
  }

  /**
   * Append a record to the provenance chain through the engine's serialized critical section.
   *
   * The path for out-of-band records (e.g. a sidecar's human-decision record on escalation
   * resolve) that must use the SAME builder as {@link Engine.guard}. Routing through here keeps
   * every append serialized — and gains the conflict-retry + builder-resync of the normal path —
   * so a concurrent guard cannot interleave with it and fork the single-builder chain.
   *
   * @param input - The record payload to chain and sign.
   * @returns The appended {@link ProvenanceRecord}.
   * @throws Propagates the store append error once retries are exhausted.
   */
  appendRecord(input: RecordInput): Promise<ProvenanceRecord> {
    return this.persist(input);
  }

  // Serializes the build+append critical section so concurrent guard() calls on
  // one engine cannot interleave and corrupt the (single-builder) chain.
  private appendQueue: Promise<unknown> = Promise.resolve();

  private persist(input: RecordInput): Promise<ProvenanceRecord> {
    const run = this.appendQueue.then(
      () => this.doPersist(input),
      () => this.doPersist(input),
    );
    this.appendQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Append the record, retrying on cross-writer conflicts by re-resuming. */
  private async doPersist(input: RecordInput): Promise<ProvenanceRecord> {
    for (let attempt = 0; ; attempt++) {
      // Snapshot the cursor BEFORE append so we can fully rewind if append (and tail re-read) fail.
      const before = this.opts.builder.cursor;
      const record = this.opts.builder.append(input);
      try {
        await this.opts.store.append(record);
        return record;
      } catch (err) {
        // builder.append() already advanced the cursor (prevHash/seq) past a record that did NOT
        // persist. Re-align the builder to the store's real tail before retrying OR propagating,
        // so the next append cannot link onto a phantom record and fork the chain.
        await this.resyncBuilderToTail(before);
        if (attempt >= this.appendRetries || !isAppendConflict(err)) throw err;
      }
    }
  }

  /** Rewind the builder cursor to the store's persisted tail, or to `fallback` if the store is unreachable. */
  private async resyncBuilderToTail(fallback: { prevHash: string; seq: number }): Promise<void> {
    try {
      const tail = await this.opts.store.tail();
      this.opts.builder.resume(tail ? tail.contentHash : GENESIS, tail ? tail.seq + 1 : 0);
    } catch {
      // Store unreachable: don't leave the cursor advanced past the phantom record — rewind it to
      // exactly where it was before this failed append, so the next attempt links correctly.
      this.opts.builder.resume(fallback.prevHash, fallback.seq);
    }
  }

  private async runSlow(check: Check, input: { action: GuardRequest['action']; context: AgentContext }): Promise<CheckResult> {
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<CheckResult>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            check: check.name,
            outcome: CheckOutcome.Inconclusive,
            verdict: this.onSlowTimeout,
            reason: `check timed out after ${this.slowBudgetMs}ms`,
            latencyMs: Date.now() - start,
          }),
        this.slowBudgetMs,
      );
    });
    // Convert a rejection to a fail-safe result so that (a) a throwing slow check votes safe, and
    // (b) a rejection that arrives AFTER the timeout already won the race cannot surface as an
    // unhandled promise rejection (which would crash the process).
    const run = check
      .run(input)
      .then((r) => ({ ...r, latencyMs: Date.now() - start }))
      .catch((err) => checkErrorResult(check, err, this.onSlowTimeout, Date.now() - start));
    try {
      return await Promise.race([run, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
