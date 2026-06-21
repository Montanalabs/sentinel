/**
 * Aggregating experiments over the scenario corpus.
 *
 * Produces the four headline outputs: the attack-success matrix (rung × attack), the mediation
 * coverage of the full protocol on a clean run, the audit's detection rate over injected violations,
 * and the concurrency-replay winner count. All four drive the real components; the experiments here
 * only orchestrate and tally.
 */

import { Verdict } from '../src/core/types.js';
import { actionDigest } from '../src/protocol/canonical-action.js';
import { commitPolicy } from '../src/protocol/policy-commitment.js';
import { commitEvidence } from '../src/protocol/evidence-commitment.js';
import { authorizationReceiptDigest, type AuthorizationReceipt } from '../src/protocol/authorization-receipt.js';
import { ExecutionStatus, type ExecutionReceipt } from '../src/protocol/execution-receipt.js';
import { auditCompleteMediation, AuditViolationType } from '../src/protocol/auditor.js';
import { buildGate, type EvalGate } from './gate.js';
import { runAttack, RUNGS, ATTACKS, type Rung, type Attack } from './rungs.js';
import type { Scenario } from './scenarios.js';

/** Attack-success rate for every (rung, attack) cell — lower is better. */
export type AttackMatrix = Record<Rung, Record<Attack, number>>;

const noop = async (): Promise<{ ok: true }> => ({ ok: true });

/** Mint a valid authorization receipt for a scenario's benign action (signed by the trusted issuer). */
function mintReceipt(gate: EvalGate, scenario: Scenario): AuthorizationReceipt {
  return gate.issuer.issue({
    actionDigest: actionDigest(scenario.authorized.canonical),
    contextDigest: scenario.contextDigest,
    policyBundleDigest: commitPolicy(scenario.policy).policyBundleDigest,
    policyVersion: scenario.policy.policyVersion,
    evidenceDigest: commitEvidence(scenario.evidence).evidenceDigest,
    deterministicVerdict: Verdict.Allow,
    finalVerdict: Verdict.Allow,
  });
}

/**
 * Run every attack against every rung over the whole corpus.
 *
 * @param scenarios - The scenario corpus.
 * @returns The attack-success rate for each (rung, attack).
 */
export async function runMatrix(scenarios: readonly Scenario[]): Promise<AttackMatrix> {
  const matrix = {} as AttackMatrix;
  for (const rung of RUNGS) {
    const row = {} as Record<Attack, number>;
    for (const attack of ATTACKS) {
      let succeeded = 0;
      for (const scenario of scenarios) if (await runAttack(rung, attack, scenario)) succeeded += 1;
      row[attack] = scenarios.length === 0 ? 0 : succeeded / scenarios.length;
    }
    matrix[rung] = row;
  }
  return matrix;
}

/**
 * Run the legitimate authorize→execute flow for every scenario and audit the resulting log.
 *
 * @param scenarios - The scenario corpus.
 * @returns The complete-mediation coverage (1.0 when every execution maps to one valid authorization).
 */
export async function mediationCoverage(scenarios: readonly Scenario[]): Promise<number> {
  const gate = buildGate();
  const authorizationReceipts: AuthorizationReceipt[] = [];
  const executionReceipts: ExecutionReceipt[] = [];
  for (const scenario of scenarios) {
    const receipt = mintReceipt(gate, scenario);
    authorizationReceipts.push(receipt);
    const res = await gate.executor.execute({ action: scenario.authorized.canonical, contextDigest: scenario.contextDigest, receipt, handler: noop });
    if (res.status === ExecutionStatus.Succeeded) executionReceipts.push(res.executionReceipt);
  }
  const report = auditCompleteMediation({ authorizationReceipts, executionReceipts, trustedAuthKeys: gate.trustedAuthKeys, trustedExecKeys: gate.trustedExecKeys });
  return report.coverage;
}

/** One injected-violation case and whether the audit flagged its expected type. */
export interface AuditCase {
  readonly name: string;
  readonly expected: AuditViolationType;
  readonly detected: boolean;
}

/**
 * Inject one execution of each violation type into a log and measure the audit's detection rate.
 *
 * @param scenario - A scenario to anchor the injected receipts.
 * @returns The per-case results and the overall detection rate (1.0 = every injected violation caught).
 */
export function auditDetectionRate(scenario: Scenario): { rate: number; cases: AuditCase[] } {
  const gate = buildGate();
  const auth = mintReceipt(gate, scenario);
  const authDigest = authorizationReceiptDigest(auth);
  const baseExec = {
    authorizationReceiptId: auth.receiptId,
    authorizationReceiptDigest: authDigest,
    actualActionDigest: auth.actionDigest,
    startedAt: new Date(Date.parse(auth.issuedAt) + 1).toISOString(),
    completedAt: new Date(Date.parse(auth.issuedAt) + 2).toISOString(),
    resultDigest: 'r'.repeat(64),
    executionStatus: ExecutionStatus.Succeeded,
  };

  const substituted = gate.executionSigner.sign({ ...baseExec, actualActionDigest: 'b'.repeat(64) });
  const orphan = gate.executionSigner.sign({ ...baseExec, authorizationReceiptId: 'rcpt_missing', authorizationReceiptDigest: 'a'.repeat(64) });
  const replayA = gate.executionSigner.sign(baseExec);
  const replayB = gate.executionSigner.sign(baseExec);
  const valid = gate.executionSigner.sign(baseExec);
  const badSig = ((): ExecutionReceipt => {
    const sig = Buffer.from(valid.signature, 'base64');
    sig[0] = (sig[0] ?? 0) ^ 0xff;
    return { ...valid, signature: sig.toString('base64') };
  })();

  const keys = { trustedAuthKeys: gate.trustedAuthKeys, trustedExecKeys: gate.trustedExecKeys };
  const detects = (auths: AuthorizationReceipt[], execs: ExecutionReceipt[], type: AuditViolationType): boolean =>
    auditCompleteMediation({ authorizationReceipts: auths, executionReceipts: execs, ...keys }).violations.some((v) => v.type === type);

  const cases: AuditCase[] = [
    { name: 'action substitution', expected: AuditViolationType.ActionSubstitution, detected: detects([auth], [substituted], AuditViolationType.ActionSubstitution) },
    { name: 'execution without authorization', expected: AuditViolationType.ExecutionWithoutAuthorization, detected: detects([auth], [orphan], AuditViolationType.ExecutionWithoutAuthorization) },
    { name: 'replayed authorization', expected: AuditViolationType.ReplayedAuthorization, detected: detects([auth], [replayA, replayB], AuditViolationType.ReplayedAuthorization) },
    { name: 'invalid execution signature', expected: AuditViolationType.InvalidExecutionSignature, detected: detects([auth], [badSig], AuditViolationType.InvalidExecutionSignature) },
  ];
  return { rate: cases.filter((c) => c.detected).length / cases.length, cases };
}

/**
 * Fire `concurrency` executors at a single single-use receipt and count how many succeed.
 *
 * @param scenario - The scenario whose benign action is executed.
 * @param concurrency - Number of parallel executors.
 * @returns The number of executors that succeeded (must be exactly 1 for a correct single-use guarantee).
 */
export async function replayConcurrency(scenario: Scenario, concurrency: number): Promise<number> {
  const gate = buildGate();
  const receipt = mintReceipt(gate, scenario);
  const args = { action: scenario.authorized.canonical, contextDigest: scenario.contextDigest, receipt, handler: noop };
  const results = await Promise.all(Array.from({ length: concurrency }, () => gate.executor.execute(args)));
  return results.filter((r) => r.status === ExecutionStatus.Succeeded).length;
}
