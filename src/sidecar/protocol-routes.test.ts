import Fastify, { type FastifyInstance } from 'fastify';
import { test, expect, describe, beforeEach } from 'vitest';
import { Signer } from '../provenance/signing.js';
import { Verdict, CheckOutcome, type CheckResult, type GuardDecision } from '../core/types.js';
import { ReceiptIssuer } from '../protocol/receipt-issuer.js';
import { ReceiptValidator } from '../protocol/receipt-validator.js';
import { Adjudicator } from '../protocol/adjudicator.js';
import { InMemoryRevocationStore } from '../protocol/revocation-store.js';
import { ExecutionReceiptSigner, ExecutionStatus, type ExecutionReceipt } from '../protocol/execution-receipt.js';
import { actionDigest } from '../protocol/canonical-action.js';
import { authorizationReceiptDigest, type AuthorizationReceipt } from '../protocol/authorization-receipt.js';
import { ProtocolErrorCode } from '../protocol/errors.js';
import { InMemoryNonceStore, InMemoryReceiptStore, InMemoryExecutionReceiptStore } from '../store/index.js';
import { registerProtocolRoutes, type ProtocolDeps } from './protocol-routes.js';

const gate = Signer.fromSeed(Buffer.alloc(32, 21));
const execKey = Signer.fromSeed(Buffer.alloc(32, 22));
const strangerKey = Signer.fromSeed(Buffer.alloc(32, 23));

const action = { actionType: 'payment', targetService: 'core-banking', operation: 'transfer', parameters: { amount: 500, from: 'a', to: 'b' }, actorId: 'agent' };
const CTX = 'c'.repeat(64);

const allow = (): CheckResult => ({ check: 'schema', outcome: CheckOutcome.Pass, verdict: Verdict.Allow });
function fakeEngine(checks: CheckResult[], verdict = Verdict.Allow): { guard: () => Promise<GuardDecision> } {
  return { guard: async () => ({ verdict, recordId: 'rec-1', checks }) };
}

function adjBody(over: Record<string, unknown> = {}) {
  return {
    guard: { action: { id: 'a1', type: 'payment', payload: { amount: 500 } }, context: { runId: 'r1' }, policy: 'fintech' },
    action,
    contextDigest: CTX,
    policy: { policyVersion: 'v1', checkerVersions: { schema: '1' }, config: {} },
    evidence: [],
    ...over,
  };
}

interface Harness {
  app: FastifyInstance;
  deps: ProtocolDeps;
  execSigner: ExecutionReceiptSigner;
}

let n = 0;
async function build(engine = fakeEngine([allow()])): Promise<Harness> {
  const trustedAuthKeys = new Map([[gate.keyId, gate.publicKeyRaw]]);
  const trustedExecKeys = new Map([[execKey.keyId, execKey.publicKeyRaw]]);
  const revocations = new InMemoryRevocationStore();
  const deps: ProtocolDeps = {
    adjudicator: new Adjudicator({ engine, issuer: new ReceiptIssuer(gate, { issuer: 'gate' }) }),
    validator: new ReceiptValidator({ trustedKeys: trustedAuthKeys, nonceStore: new InMemoryNonceStore(), revocations }),
    receipts: new InMemoryReceiptStore(),
    executions: new InMemoryExecutionReceiptStore(),
    revocations,
    trustedAuthKeys,
    trustedExecKeys,
  };
  const app = Fastify({ logger: false });
  registerProtocolRoutes(app, deps);
  await app.ready();
  return { app, deps, execSigner: new ExecutionReceiptSigner(execKey, 'bank-exec', () => `exec_${(n += 1)}`) };
}

function makeExec(h: Harness, receipt: AuthorizationReceipt, over: Partial<Parameters<ExecutionReceiptSigner['sign']>[0]> = {}): ExecutionReceipt {
  return h.execSigner.sign({
    authorizationReceiptId: receipt.receiptId,
    authorizationReceiptDigest: authorizationReceiptDigest(receipt),
    actualActionDigest: receipt.actionDigest,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    resultDigest: 'r'.repeat(64),
    executionStatus: ExecutionStatus.Succeeded,
    ...over,
  });
}

async function issue(h: Harness): Promise<AuthorizationReceipt> {
  const res = await h.app.inject({ method: 'POST', url: '/v1/adjudications', payload: adjBody() });
  return res.json().receipt as AuthorizationReceipt;
}

describe('protocol routes', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });

  describe('POST /v1/adjudications', () => {
    test('an ALLOW adjudication issues, persists, and returns a receipt', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/v1/adjudications', payload: adjBody() });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.finalVerdict).toBe(Verdict.Allow);
      expect(body.receipt.actionDigest).toBe(actionDigest(action));
      expect(await h.deps.receipts.get(body.receipt.receiptId)).toBeTruthy();
    });

    test('a BLOCK adjudication returns no receipt', async () => {
      const blocked = await build(fakeEngine([{ check: 'sanctions', outcome: CheckOutcome.Fail, verdict: Verdict.Block }], Verdict.Block));
      const res = await blocked.app.inject({ method: 'POST', url: '/v1/adjudications', payload: adjBody() });
      expect(res.json().finalVerdict).toBe(Verdict.Block);
      expect(res.json().receipt).toBeUndefined();
    });

    test('a malformed body is rejected with 400', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/v1/adjudications', payload: { nonsense: true } });
      expect(res.statusCode).toBe(400);
    });

    test('a non-canonical action is rejected with 400', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/v1/adjudications',
        payload: adjBody({ action: { ...action, actorId: '' } }), // empty required field
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /v1/receipts/validate', () => {
    test('a fresh receipt validates once, then replays', async () => {
      const receipt = await issue(h);
      const binding = { actionDigest: actionDigest(action), contextDigest: CTX };
      const first = await h.app.inject({ method: 'POST', url: '/v1/receipts/validate', payload: { receipt, binding } });
      expect(first.json()).toEqual({ ok: true, executionCount: 1 });
      const second = await h.app.inject({ method: 'POST', url: '/v1/receipts/validate', payload: { receipt, binding } });
      expect(second.json().ok).toBe(false);
      expect(second.json().error.code).toBe(ProtocolErrorCode.ReplayDetected);
    });

    test('an action-digest mismatch fails without burning the nonce', async () => {
      const receipt = await issue(h);
      const wrong = await h.app.inject({
        method: 'POST',
        url: '/v1/receipts/validate',
        payload: { receipt, binding: { actionDigest: 'b'.repeat(64), contextDigest: CTX } },
      });
      expect(wrong.json().error.code).toBe(ProtocolErrorCode.ActionMismatch);
      // The correct binding still validates — the rejected attempt did not consume the slot.
      const ok = await h.app.inject({
        method: 'POST',
        url: '/v1/receipts/validate',
        payload: { receipt, binding: { actionDigest: actionDigest(action), contextDigest: CTX } },
      });
      expect(ok.json().ok).toBe(true);
    });
  });

  describe('POST /v1/receipts/revoke', () => {
    test('a revoked receipt fails validation as REVOKED_RECEIPT', async () => {
      const receipt = await issue(h);
      const rev = await h.app.inject({ method: 'POST', url: '/v1/receipts/revoke', payload: { receiptId: receipt.receiptId } });
      expect(rev.json()).toEqual({ revoked: true, receiptId: receipt.receiptId });
      const res = await h.app.inject({
        method: 'POST',
        url: '/v1/receipts/validate',
        payload: { receipt, binding: { actionDigest: actionDigest(action), contextDigest: CTX } },
      });
      expect(res.json().error.code).toBe(ProtocolErrorCode.RevokedReceipt);
    });
  });

  describe('POST /v1/executions + GET /v1/audit', () => {
    test('a trusted execution receipt is ingested and audits clean', async () => {
      const receipt = await issue(h);
      const exec = makeExec(h, receipt);
      const ingest = await h.app.inject({ method: 'POST', url: '/v1/executions', payload: exec });
      expect(ingest.json()).toEqual({ stored: true, executionId: exec.executionId });

      const audit = await h.app.inject({ method: 'GET', url: '/v1/audit/verify' });
      expect(audit.json().valid).toBe(true);
      expect(audit.json().coverage).toBe(1);

      const coverage = await h.app.inject({ method: 'GET', url: '/v1/audit/coverage' });
      expect(coverage.json()).toEqual({ valid: true, executionsChecked: 1, coverage: 1 });
    });

    test('an execution receipt signed by an untrusted key is rejected with 400', async () => {
      const receipt = await issue(h);
      const stranger = new ExecutionReceiptSigner(strangerKey, 'rogue', () => 'exec_rogue');
      const exec = stranger.sign({
        authorizationReceiptId: receipt.receiptId,
        authorizationReceiptDigest: authorizationReceiptDigest(receipt),
        actualActionDigest: receipt.actionDigest,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        resultDigest: 'r'.repeat(64),
        executionStatus: ExecutionStatus.Succeeded,
      });
      const res = await h.app.inject({ method: 'POST', url: '/v1/executions', payload: exec });
      expect(res.statusCode).toBe(400);
    });

    test('an action-substituted execution is detected by the audit', async () => {
      const receipt = await issue(h);
      const tampered = makeExec(h, receipt, { actualActionDigest: 'b'.repeat(64) });
      await h.app.inject({ method: 'POST', url: '/v1/executions', payload: tampered });
      const audit = await h.app.inject({ method: 'GET', url: '/v1/audit/verify' });
      expect(audit.json().valid).toBe(false);
      expect(audit.json().violations.map((v: { type: string }) => v.type)).toContain('ACTION_SUBSTITUTION');
    });
  });
});
