import { test, expect, describe } from 'vitest';
import { Signer } from '../provenance/signing.js';
import { Verdict } from '../core/types.js';
import { actionDigest, type CanonicalAction } from './canonical-action.js';
import { ReceiptIssuer } from './receipt-issuer.js';
import { authorizationReceiptDigest, type AuthorizationReceipt } from './authorization-receipt.js';
import { ExecutionReceiptSigner, ExecutionStatus, type ExecutionReceipt } from './execution-receipt.js';
import { auditCompleteMediation, AuditViolationType, type AuditInput } from './auditor.js';

const gate = Signer.fromSeed(Buffer.alloc(32, 1));
const exec = Signer.fromSeed(Buffer.alloc(32, 2));
const NOW = 1_700_000_000_000;
const CTX = 'c'.repeat(64);

const action: CanonicalAction = {
  actionType: 'payment',
  targetService: 'core-banking',
  operation: 'transfer',
  parameters: { amount: 500, from: 'a', to: 'b' },
  actorId: 'agent',
};

const issuer = new ReceiptIssuer(gate, { issuer: 'gate', now: () => NOW, defaultTtlMs: 60_000 });
let execN = 0;
const execSigner = new ExecutionReceiptSigner(exec, 'bank-exec', () => `exec_${++execN}`);

function freshAuth(over: Partial<Parameters<ReceiptIssuer['issue']>[0]> = {}): AuthorizationReceipt {
  return issuer.issue({
    actionDigest: actionDigest(action),
    contextDigest: CTX,
    policyBundleDigest: 'f'.repeat(64),
    policyVersion: 'v1',
    evidenceDigest: 'e'.repeat(64),
    deterministicVerdict: Verdict.Allow,
    finalVerdict: Verdict.Allow,
    ...over,
  });
}

function execFor(auth: AuthorizationReceipt, over: Partial<Parameters<ExecutionReceiptSigner['sign']>[0]> = {}): ExecutionReceipt {
  return execSigner.sign({
    authorizationReceiptId: auth.receiptId,
    authorizationReceiptDigest: authorizationReceiptDigest(auth),
    actualActionDigest: auth.actionDigest,
    startedAt: new Date(NOW + 1000).toISOString(),
    completedAt: new Date(NOW + 1500).toISOString(),
    resultDigest: 'r'.repeat(64),
    executionStatus: ExecutionStatus.Succeeded,
    ...over,
  });
}

const keys = (): Pick<AuditInput, 'trustedAuthKeys' | 'trustedExecKeys'> => ({
  trustedAuthKeys: new Map([[gate.keyId, gate.publicKeyRaw]]),
  trustedExecKeys: new Map([[exec.keyId, exec.publicKeyRaw]]),
});

describe('auditCompleteMediation', () => {
  test('a clean set audits valid with coverage 1.0', () => {
    const auth = freshAuth();
    const report = auditCompleteMediation({ authorizationReceipts: [auth], executionReceipts: [execFor(auth)], ...keys() });
    expect(report).toEqual({ valid: true, executionsChecked: 1, violations: [], coverage: 1 });
  });

  test('execution without authorization', () => {
    const orphan = execFor(freshAuth());
    const r = auditCompleteMediation({ authorizationReceipts: [], executionReceipts: [orphan], ...keys() });
    expect(r.valid).toBe(false);
    expect(r.violations.map((v) => v.type)).toContain(AuditViolationType.ExecutionWithoutAuthorization);
    expect(r.coverage).toBe(0);
  });

  test('action substitution (valid exec signature, mismatched action)', () => {
    const auth = freshAuth();
    const tampered = execFor(auth, { actualActionDigest: 'b'.repeat(64) });
    const r = auditCompleteMediation({ authorizationReceipts: [auth], executionReceipts: [tampered], ...keys() });
    expect(r.violations.map((v) => v.type)).toContain(AuditViolationType.ActionSubstitution);
  });

  test('replayed authorization (two executions of a single-use receipt)', () => {
    const auth = freshAuth(); // maxExecutions = 1
    const r = auditCompleteMediation({ authorizationReceipts: [auth], executionReceipts: [execFor(auth), execFor(auth)], ...keys() });
    expect(r.violations.map((v) => v.type)).toContain(AuditViolationType.ReplayedAuthorization);
    expect(r.executionsChecked).toBe(2);
  });

  test('invalid execution signature', () => {
    const auth = freshAuth();
    const e = execFor(auth);
    const bad = Buffer.from(e.signature, 'base64');
    bad[0] = (bad[0] ?? 0) ^ 0xff;
    const r = auditCompleteMediation({ authorizationReceipts: [auth], executionReceipts: [{ ...e, signature: bad.toString('base64') }], ...keys() });
    expect(r.violations.map((v) => v.type)).toContain(AuditViolationType.InvalidExecutionSignature);
  });

  test('execution outside the authorization validity window', () => {
    const auth = freshAuth(); // expires NOW + 60s
    const late = execFor(auth, { startedAt: new Date(NOW + 120_000).toISOString() });
    const r = auditCompleteMediation({ authorizationReceipts: [auth], executionReceipts: [late], ...keys() });
    expect(r.violations.map((v) => v.type)).toContain(AuditViolationType.ExpiredAuthorization);
  });

  test('multiple authorizations sharing an id', () => {
    const auth = freshAuth();
    const r = auditCompleteMediation({ authorizationReceipts: [auth, auth], executionReceipts: [execFor(auth)], ...keys() });
    expect(r.violations.map((v) => v.type)).toContain(AuditViolationType.MultipleAuthorizations);
  });

  test('coverage reflects the clean fraction', () => {
    const a1 = freshAuth();
    const a2 = freshAuth();
    const orphan = execFor(freshAuth());
    const r = auditCompleteMediation({
      authorizationReceipts: [a1, a2],
      executionReceipts: [execFor(a1), execFor(a2), orphan],
      ...keys(),
    });
    expect(r.executionsChecked).toBe(3);
    expect(r.coverage).toBeCloseTo(2 / 3);
  });

  test('a REJECTED substitution-attempt receipt is not a violation (blocked != executed)', () => {
    const auth = freshAuth();
    // The executor refused a substitution: it signs a REJECTED receipt whose actualActionDigest is
    // the unsafe action. This must NOT be audited as ACTION_SUBSTITUTION, and must not lower coverage.
    const rejected = execFor(auth, { actualActionDigest: 'b'.repeat(64), executionStatus: ExecutionStatus.Rejected });
    const r = auditCompleteMediation({ authorizationReceipts: [auth], executionReceipts: [execFor(auth), rejected], ...keys() });
    expect(r.valid).toBe(true);
    expect(r.executionsChecked).toBe(1); // only the real execution counts
    expect(r.coverage).toBe(1);
  });

  test('REJECTED replay attempts do not trigger ReplayedAuthorization', () => {
    const auth = freshAuth(); // maxExecutions = 1
    const reject = (): ExecutionReceipt => execFor(auth, { executionStatus: ExecutionStatus.Rejected });
    const r = auditCompleteMediation({ authorizationReceipts: [auth], executionReceipts: [execFor(auth), reject(), reject()], ...keys() });
    expect(r.violations.map((v) => v.type)).not.toContain(AuditViolationType.ReplayedAuthorization);
    expect(r.valid).toBe(true);
  });
});
