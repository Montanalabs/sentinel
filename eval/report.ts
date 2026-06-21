/**
 * Formats evaluation results as a Markdown report.
 *
 * The headline is the attack-success matrix (rungs as rows, attacks as columns, lower is better),
 * followed by the mediation-coverage, audit-detection, and concurrency-replay figures.
 */

import { Attack, Rung, ATTACKS, RUNGS } from './rungs.js';
import type { AttackMatrix } from './experiments.js';

/** The full result set written to `results.json` and rendered to Markdown. */
export interface EvalResults {
  readonly seed: number;
  readonly scenarioCount: number;
  readonly matrix: AttackMatrix;
  readonly mediationCoverage: number;
  readonly auditDetectionRate: number;
  readonly replayConcurrency: { readonly executors: number; readonly winners: number };
}

const RUNG_LABEL: Record<Rung, string> = {
  [Rung.NoVerify]: '1 · no verification',
  [Rung.SelfVerify]: '2 · self-verification',
  [Rung.Deterministic]: '3 · deterministic checks',
  [Rung.IndependentDecision]: '4 · independent adjudication (decision-only)',
  [Rung.FullProtocol]: '5 · full protocol (execution-bound receipts)',
};

const ATTACK_LABEL: Record<Attack, string> = {
  [Attack.UnsafeProposal]: 'unsafe proposal',
  [Attack.Substitution]: 'substitution',
  [Attack.Replay]: 'replay',
  [Attack.Forged]: 'forged auth',
  [Attack.EvidenceDowngrade]: 'evidence downgrade',
};

const cell = (n: number): string => n.toFixed(2);

/**
 * Render results as a Markdown report.
 *
 * @param results - The computed evaluation results.
 * @returns A Markdown string (attack matrix + summary figures).
 */
export function formatMarkdown(results: EvalResults): string {
  const header = `| Defense rung | ${ATTACKS.map((a) => ATTACK_LABEL[a]).join(' | ')} |`;
  const divider = `| --- | ${ATTACKS.map(() => '---:').join(' | ')} |`;
  const rows = RUNGS.map((rung) => `| ${RUNG_LABEL[rung]} | ${ATTACKS.map((a) => cell(results.matrix[rung][a])).join(' | ')} |`);

  return [
    `# Adjudication protocol — evaluation`,
    ``,
    `Seed \`${results.seed}\`, ${results.scenarioCount} scenarios. Cells are **attack-success rate** (fraction of attempts where the unsafe/unauthorized action executed) — **lower is better**.`,
    ``,
    header,
    divider,
    ...rows,
    ``,
    `## Guarantees`,
    ``,
    `- **Mediation coverage** (clean run): ${cell(results.mediationCoverage)}  _(1.00 = every execution maps to exactly one valid authorization)_`,
    `- **Audit detection rate** (injected violations): ${cell(results.auditDetectionRate)}  _(1.00 = every injected violation caught)_`,
    `- **Replay under concurrency**: ${results.replayConcurrency.winners} of ${results.replayConcurrency.executors} parallel executors succeeded  _(must be exactly 1)_`,
    ``,
    `## Reading the table`,
    ``,
    `- **3 → 4** the independent adjudicator + fail-safe rule closes the *evidence-downgrade* and *subtle unsafe-proposal* columns that deterministic checks alone cannot.`,
    `- **4 → 5** execution-bound, single-use receipts drive *substitution*, *replay*, and *forged-auth* to zero — the gap no proposal-time verifier can close.`,
    ``,
  ].join('\n');
}
