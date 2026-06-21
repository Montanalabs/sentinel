/**
 * Offline policy back-testing ("what-if") over historical decisions.
 *
 * Replays a batch of past {@link ProvenanceRecord}s through a candidate set of
 * {@link Check}s in a throwaway in-memory engine and reports which verdicts
 * would change. It is the safe pre-flight for a policy rollout: it produces no
 * persisted provenance and touches no production {@link ProvenanceStore}.
 */

import type { ProvenanceRecord } from '../provenance/record.js';
import type { Check } from '../checks/types.js';
import type { Verdict, AgentContext } from '../core/types.js';
import { Engine } from '../engine/engine.js';
import { InMemoryStore } from '../store/memory.js';
import { RecordBuilder } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';

/**
 * A single decision that the candidate policy would flip relative to history.
 *
 * @see {@link simulate} which produces these.
 */
export interface SimChange {
  /** Id of the historical {@link ProvenanceRecord} whose verdict would change. */
  recordId: string;
  /** The originally recorded {@link Verdict}. */
  was: Verdict;
  /** The {@link Verdict} the candidate checks would produce instead. */
  now: Verdict;
  /** Reason attached to the new verdict, when the candidate checks supply one. */
  nowReason?: string;
}

/**
 * Result of a back-test: how many decisions hold versus change under a
 * candidate policy, with each change enumerated.
 *
 * @see {@link simulate} which produces this shape.
 */
export interface SimReport {
  /** Number of historical records replayed. */
  total: number;
  /** Count of records whose verdict is unchanged by the candidate policy. */
  unchanged: number;
  /** Every decision the candidate policy would flip. */
  changed: SimChange[];
  /** Count of changes keyed by `"<was>-><now>"` verdict transition. */
  byTransition: Record<string, number>;
}

/**
 * Back-test a candidate set of checks against historical decisions WITHOUT
 * emitting new provenance.
 *
 * Each record's original {@link Action} and {@link AgentContext} are re-gated by
 * a fresh {@link Engine} backed by an {@link InMemoryStore} and an ephemeral
 * {@link Signer}, so nothing reaches the production store and the throwaway
 * signing key is discarded when the call returns. The slow tier is allowed to
 * run to completion (block short-circuiting is disabled) so the candidate's full
 * effect is measured. This is the safe way to preview a policy update before
 * rollout.
 *
 * @param records - Historical decisions to replay; not mutated.
 * @param candidate - The ordered candidate {@link Check}s to evaluate against,
 *   used for every record regardless of the record's original policy.
 * @returns A {@link SimReport} contrasting historical and candidate verdicts.
 * @throws If a candidate {@link Check} rejects while running, the rejection
 *   propagates from the awaited {@link Engine.guard} call.
 * @throws If the in-memory provenance append rejects (duplicate id or
 *   non-monotonic seq), the error propagates from {@link Engine.guard}.
 * @example
 * const report = await simulate(await store.list(), candidateChecks);
 * if (report.changed.length === 0) console.log('policy is a no-op');
 */
export async function simulate(records: readonly ProvenanceRecord[], candidate: Check[]): Promise<SimReport> {
  const store = new InMemoryStore();
  const builder = new RecordBuilder(Signer.generate());
  const engine = new Engine({ resolve: () => candidate, builder, store, shortCircuitOnBlock: false });

  const changed: SimChange[] = [];
  const byTransition: Record<string, number> = {};
  let unchanged = 0;

  for (const r of records) {
    const context: AgentContext = r.context;
    const decision = await engine.guard({ action: r.action, context, policy: 'sim' });
    if (decision.verdict === r.verdict) {
      unchanged++;
    } else {
      const key = `${r.verdict}->${decision.verdict}`;
      byTransition[key] = (byTransition[key] ?? 0) + 1;
      changed.push({
        recordId: r.id,
        was: r.verdict,
        now: decision.verdict,
        ...(decision.reason ? { nowReason: decision.reason } : {}),
      });
    }
  }

  return { total: records.length, unchanged, changed, byTransition };
}
