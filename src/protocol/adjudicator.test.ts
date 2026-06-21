import { test, expect, describe } from 'vitest';
import { Signer } from '../provenance/signing.js';
import { Verdict, CheckOutcome } from '../core/types.js';
import type { CheckResult, GuardDecision, GuardRequest } from '../core/types.js';
import { actionDigest, type CanonicalAction } from './canonical-action.js';
import { commitPolicy, type PolicyManifest } from './policy-commitment.js';
import { commitEvidence, type EvidenceItem } from './evidence-commitment.js';
import { verifyReceiptSignature } from './authorization-receipt.js';
import { ReceiptIssuer } from './receipt-issuer.js';
import { Ownership, Boundary, IndependenceWarningCode } from './verifier-independence.js';
import { Adjudicator, type AdjudicationRequest } from './adjudicator.js';

const gate = Signer.fromSeed(Buffer.alloc(32, 7));
const NOW = 1_700_000_000_000;
const issuer = new ReceiptIssuer(gate, { issuer: 'gate', now: () => NOW, defaultTtlMs: 60_000 });

const action: CanonicalAction = {
  actionType: 'payment',
  targetService: 'core-banking',
  operation: 'transfer',
  parameters: { amount: 500, from: 'a', to: 'b' },
  actorId: 'agent-1',
};

const policy: PolicyManifest = { policyVersion: 'fintech.payments@1', checkerVersions: { schema: '1', reconcile: '2' }, config: { limit: 1000 } };

const evidence: EvidenceItem[] = [
  {
    sourceId: 'ledger',
    sourceType: 'ledger',
    queryDigest: 'a'.repeat(64),
    responseDigest: 'b'.repeat(64),
    retrievedAt: new Date(NOW).toISOString(),
    trustLevel: 'authoritative',
    availabilityStatus: 'available',
  },
];

const guardRequest: GuardRequest = {
  action: { id: 'act-1', type: 'payment', payload: { amount: 500 } },
  context: { runId: 'run-1' },
  policy: 'fintech.payments',
};

const CTX = 'c'.repeat(64);

function check(name: string, verdict: Verdict): CheckResult {
  return { check: name, outcome: verdict === Verdict.Allow ? CheckOutcome.Pass : CheckOutcome.Fail, verdict };
}

function fakeEngine(checks: CheckResult[], verdict = Verdict.Allow): { guard: () => Promise<GuardDecision> } {
  return { guard: async () => ({ verdict, recordId: 'rec-1', checks }) };
}

function request(over: Partial<AdjudicationRequest> = {}): AdjudicationRequest {
  return { guard: guardRequest, action, contextDigest: CTX, policy, evidence, ...over };
}

describe('Adjudicator', () => {
  test('all-allow with available evidence issues a signed receipt bound to the action/context/policy/evidence', async () => {
    const adj = new Adjudicator({ engine: fakeEngine([check('schema', Verdict.Allow), check('reconcile', Verdict.Allow)]), issuer });
    const r = await adj.adjudicate(request());

    expect(r.adjudication.finalVerdict).toBe(Verdict.Allow);
    expect(r.receipt).toBeDefined();
    const receipt = r.receipt!;
    expect(receipt.actionDigest).toBe(actionDigest(action));
    expect(receipt.contextDigest).toBe(CTX);
    expect(receipt.policyBundleDigest).toBe(commitPolicy(policy).policyBundleDigest);
    expect(receipt.evidenceDigest).toBe(commitEvidence(evidence).evidenceDigest);
    expect(receipt.finalVerdict).toBe(Verdict.Allow);
    expect(verifyReceiptSignature(receipt, gate.publicKeyRaw)).toBe(true);
  });

  test('a hard BLOCK check yields BLOCK and no receipt', async () => {
    const adj = new Adjudicator({ engine: fakeEngine([check('schema', Verdict.Allow), check('sanctions', Verdict.Block)], Verdict.Block), issuer });
    const r = await adj.adjudicate(request());
    expect(r.adjudication.finalVerdict).toBe(Verdict.Block);
    expect(r.receipt).toBeUndefined();
  });

  test('an ESCALATE check yields ESCALATE and no receipt', async () => {
    const adj = new Adjudicator({ engine: fakeEngine([check('reconcile', Verdict.Escalate)], Verdict.Escalate), issuer });
    const r = await adj.adjudicate(request());
    expect(r.adjudication.finalVerdict).toBe(Verdict.Escalate);
    expect(r.receipt).toBeUndefined();
  });

  test('all checks allow but a required evidence source is unavailable → ESCALATE, no receipt', async () => {
    const stale: EvidenceItem[] = [{ ...evidence[0]!, availabilityStatus: 'unavailable' }];
    const adj = new Adjudicator({ engine: fakeEngine([check('schema', Verdict.Allow)]), issuer });
    const r = await adj.adjudicate(request({ evidence: stale }));
    expect(r.adjudication.finalVerdict).toBe(Verdict.Escalate);
    expect(r.adjudication.reason).toContain('ledger');
    expect(r.receipt).toBeUndefined();
  });

  test('an independent-model BLOCK blocks by default and escalates when configured', async () => {
    const blockAdj = new Adjudicator({ engine: fakeEngine([check('schema', Verdict.Allow)]), issuer });
    const blocked = await blockAdj.adjudicate(request({ model: { verdict: Verdict.Block, confidence: 0.9 } }));
    expect(blocked.adjudication.finalVerdict).toBe(Verdict.Block);
    expect(blocked.receipt).toBeUndefined();

    const escAdj = new Adjudicator({ engine: fakeEngine([check('schema', Verdict.Allow)]), issuer, modelBlockVerdict: Verdict.Escalate });
    const escalated = await escAdj.adjudicate(request({ model: { verdict: Verdict.Block, confidence: 0.9 } }));
    expect(escalated.adjudication.finalVerdict).toBe(Verdict.Escalate);
  });

  test('a model below the confidence threshold escalates', async () => {
    const adj = new Adjudicator({ engine: fakeEngine([check('schema', Verdict.Allow)]), issuer, modelConfidenceThreshold: 0.8 });
    const r = await adj.adjudicate(request({ model: { verdict: Verdict.Allow, confidence: 0.4 } }));
    expect(r.adjudication.finalVerdict).toBe(Verdict.Escalate);
    expect(r.receipt).toBeUndefined();
  });

  test('an advisory (non-hard) BLOCK cannot force BLOCK — it escalates and issues no receipt', async () => {
    const adj = new Adjudicator({
      engine: fakeEngine([check('schema', Verdict.Allow), check('advisory-list', Verdict.Block)]),
      issuer,
      classifyHard: (c) => c.check !== 'advisory-list',
    });
    const r = await adj.adjudicate(request());
    expect(r.adjudication.finalVerdict).toBe(Verdict.Escalate);
    expect(r.adjudication.deterministicVerdict).toBe(Verdict.Block);
    expect(r.receipt).toBeUndefined();
  });

  test('surfaces verifier-independence warnings without changing the verdict', async () => {
    const adj = new Adjudicator({ engine: fakeEngine([check('schema', Verdict.Allow)]), issuer });
    const r = await adj.adjudicate(
      request({
        independence: {
          actorProvider: 'openai',
          actorModel: 'gpt-4o',
          verifierProvider: 'openai',
          verifierModel: 'gpt-4o',
          promptOwnedBy: Ownership.Gate,
          policyOwnedBy: Ownership.Gate,
          contextConstructedBy: Ownership.Gate,
          deploymentBoundary: Boundary.Separate,
          credentialBoundary: Boundary.Separate,
        },
      }),
    );
    expect(r.adjudication.finalVerdict).toBe(Verdict.Allow);
    expect(r.independenceWarnings.map((w) => w.code)).toContain(IndependenceWarningCode.SameModel);
    expect(r.receipt).toBeDefined();
  });

  test('the result always carries the policy and evidence commitments', async () => {
    const adj = new Adjudicator({ engine: fakeEngine([check('schema', Verdict.Allow)]), issuer });
    const r = await adj.adjudicate(request());
    expect(r.policy).toEqual(commitPolicy(policy));
    expect(r.evidence).toEqual(commitEvidence(evidence));
  });
});
