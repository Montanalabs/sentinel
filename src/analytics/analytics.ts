/**
 * Read-only aggregation over the provenance log.
 *
 * Turns a batch of immutable {@link ProvenanceRecord}s into summary statistics
 * ({@link Analytics}) and per-run coverage reports ({@link RunCoverage}) for
 * reporting and audit views. Pure and side-effect free: it reads records the
 * engine already emitted and never gates actions, persists, or signs.
 */

import type { ProvenanceRecord } from '../provenance/record.js';
import { Verdict } from '../core/types.js';
import { actionFingerprint } from '../core/action.js';

/**
 * Aggregate decision statistics over a set of provenance records.
 *
 * Counts and rates are keyed by {@link Verdict}, action type, and tenant, with
 * the most common block/escalate reasons surfaced. Rates are fractions in the
 * range `[0, 1]` and sum to `1` across the three verdicts (or are all `0` when
 * there are no records).
 *
 * @see {@link analyze} which produces this shape.
 */
export interface Analytics {
  /** Total number of records aggregated. */
  total: number;
  /** Record count per {@link Verdict}. */
  byVerdict: Record<Verdict, number>;
  /** Fraction of records with verdict ALLOW, in `[0, 1]`. */
  allowRate: number;
  /** Fraction of records with verdict BLOCK, in `[0, 1]`. */
  blockRate: number;
  /** Fraction of records with verdict ESCALATE, in `[0, 1]`. */
  escalateRate: number;
  /** Record count per action type. */
  byActionType: Record<string, number>;
  /** Record count per tenant (records without a tenant are omitted). */
  byTenant: Record<string, number>;
  /** Block/escalate reasons sorted by descending count. */
  topReasons: Array<{ reason: string; count: number }>;
}

function inc(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/**
 * Aggregate decision analytics over a set of provenance records.
 *
 * Tallies verdicts, action types, and tenants in a single pass, and ranks the
 * reasons attached to non-ALLOW decisions. Rates are guarded against an empty
 * input (all `0` when `records` is empty), so this is safe to call on a fresh
 * log.
 *
 * @param records - Records to summarize; order is irrelevant and the input is
 *   not mutated.
 * @returns The aggregated {@link Analytics} snapshot.
 */
export function analyze(records: readonly ProvenanceRecord[]): Analytics {
  const acc = createAnalyticsAccumulator();
  acc.add(records);
  return acc.finalize();
}

/**
 * Incremental {@link Analytics} aggregator for processing records in bounded batches.
 *
 * Lets a caller fold an arbitrarily long chain into an {@link Analytics} snapshot without ever
 * holding all records in memory at once — e.g. the sidecar's `/v1/analytics` route pages through
 * the store and calls {@link add} per page, then {@link finalize}. {@link analyze} is the
 * one-shot convenience built on this.
 *
 * @returns An accumulator with `add(records)` and `finalize()`.
 */
export function createAnalyticsAccumulator(): {
  add: (records: readonly ProvenanceRecord[]) => void;
  finalize: () => Analytics;
} {
  const byVerdict: Record<Verdict, number> = { [Verdict.Allow]: 0, [Verdict.Block]: 0, [Verdict.Escalate]: 0 };
  const byActionType: Record<string, number> = {};
  const byTenant: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  let total = 0;

  return {
    add(records) {
      for (const r of records) {
        total++;
        byVerdict[r.verdict]++;
        inc(byActionType, r.action.type);
        if (r.tenant) inc(byTenant, r.tenant);
        if (r.verdict !== Verdict.Allow && r.reason) inc(reasons, r.reason);
      }
    },
    finalize() {
      const rate = (n: number) => (total === 0 ? 0 : n / total);
      const topReasons = Object.entries(reasons)
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);
      return {
        total,
        byVerdict,
        allowRate: rate(byVerdict.ALLOW),
        blockRate: rate(byVerdict.BLOCK),
        escalateRate: rate(byVerdict.ESCALATE),
        byActionType,
        byTenant,
        topReasons,
      };
    },
  };
}

/**
 * Audit coverage for a single agent run: which actions were gated and whether
 * any action was processed more than once.
 *
 * Scoped to one `runId` (the {@link AgentContext} correlation id), this lists
 * every gated {@link Action} with its {@link Verdict} and flags repeated action
 * fingerprints that may indicate a replay or duplicate submission.
 *
 * @see {@link runCoverage} which produces this shape.
 */
export interface RunCoverage {
  /** The run this coverage report is scoped to. */
  runId: string;
  /** Number of gated actions in the run. */
  total: number;
  /** Verdict counts within the run. */
  verdicts: Record<Verdict, number>;
  /** Each gated action with its id, type, and {@link Verdict}, in record order. */
  actions: Array<{ id: string; type: string; verdict: Verdict }>;
  /** Action fingerprints that appear more than once in the run (possible replay/dup). */
  duplicateFingerprints: string[];
}

/**
 * Build the {@link RunCoverage} report for one agent run.
 *
 * Filters `records` to the given run, tallies verdicts, and detects repeated
 * action fingerprints (via {@link actionFingerprint}) so a caller can spot
 * replays or duplicate gating within the run. An unknown `runId` yields a
 * report with `total: 0` rather than an error.
 *
 * @param records - The full record set to filter; not mutated.
 * @param runId - The {@link AgentContext} run id to report on.
 * @returns The {@link RunCoverage} for the matching records.
 */
export function runCoverage(records: readonly ProvenanceRecord[], runId: string): RunCoverage {
  const inRun = records.filter((r) => r.context.runId === runId);
  const verdicts: Record<Verdict, number> = { [Verdict.Allow]: 0, [Verdict.Block]: 0, [Verdict.Escalate]: 0 };
  const seen = new Map<string, number>();
  const actions = inRun.map((r) => {
    verdicts[r.verdict]++;
    const fp = actionFingerprint(r.action);
    seen.set(fp, (seen.get(fp) ?? 0) + 1);
    return { id: r.action.id, type: r.action.type, verdict: r.verdict };
  });
  const duplicateFingerprints = [...seen.entries()].filter(([, n]) => n > 1).map(([fp]) => fp);
  return { runId, total: inRun.length, verdicts, actions, duplicateFingerprints };
}
