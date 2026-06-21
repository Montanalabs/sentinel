import { test, expect, describe, beforeEach } from 'vitest';
import { Signer } from '../provenance/signing.js';
import { Verdict } from '../core/types.js';
import { InMemoryNonceStore } from '../store/nonce-memory.js';
import { actionDigest, type CanonicalAction } from './canonical-action.js';
import { ReceiptIssuer } from './receipt-issuer.js';
import { ReceiptValidator } from './receipt-validator.js';
import { ExecutionReceiptSigner, ExecutionStatus, verifyExecutionReceiptSignature } from './execution-receipt.js';
import { ProtectedExecutor } from './protected-executor.js';
import { ProtocolErrorCode } from './errors.js';

// Distinct keys: the gate (issuer) and the executor sign with separate identities.
const gateSigner = Signer.fromSeed(Buffer.alloc(32, 1));
const execSigner = Signer.fromSeed(Buffer.alloc(32, 2));
const NOW = 1_700_000_000_000;
const CTX = 'c'.repeat(64);

const action: CanonicalAction = {
  actionType: 'payment',
  targetService: 'core-banking',
  operation: 'transfer',
  parameters: { amount: 500, from: 'acct_ops', to: 'vendor_42' },
  actorId: 'agent-007',
  tenant: 'acme',
};

function setup() {
  const issuer = new ReceiptIssuer(gateSigner, { issuer: 'gate', now: () => NOW, defaultTtlMs: 60_000 });
  const nonceStore = new InMemoryNonceStore();
  const validator = new ReceiptValidator({
    trustedKeys: new Map([[gateSigner.keyId, gateSigner.publicKeyRaw]]),
    nonceStore,
    now: () => NOW,
  });
  let n = 0;
  const execReceiptSigner = new ExecutionReceiptSigner(execSigner, 'core-banking-executor', () => `exec_${++n}`);
  const executor = new ProtectedExecutor(validator, execReceiptSigner, { now: () => NOW });
  // A receipt the gate issued for THIS exact action + context.
  const receipt = issuer.issue({
    actionDigest: actionDigest(action),
    contextDigest: CTX,
    policyBundleDigest: 'f'.repeat(64),
    policyVersion: 'fintech.payments@1',
    evidenceDigest: 'e'.repeat(64),
    deterministicVerdict: Verdict.Allow,
    modelVerdict: Verdict.Allow,
    finalVerdict: Verdict.Allow,
  });
  return { executor, receipt };
}

describe('ProtectedExecutor — full workflow', () => {
  let executor: ProtectedExecutor;
  let receipt: ReturnType<typeof setup>['receipt'];
  beforeEach(() => {
    ({ executor, receipt } = setup());
  });

  test('runs the handler once and returns a valid, signed SUCCEEDED execution receipt', async () => {
    let ran = 0;
    const out = await executor.execute({
      action,
      contextDigest: CTX,
      receipt,
      handler: async () => {
        ran++;
        return { ok: true, txId: 'tx_1' };
      },
      externalReference: 'tx_1',
    });
    expect(ran).toBe(1);
    expect(out.status).toBe(ExecutionStatus.Succeeded);
    expect(out.result).toEqual({ ok: true, txId: 'tx_1' });
    const er = out.executionReceipt;
    expect(er.executionStatus).toBe(ExecutionStatus.Succeeded);
    expect(er.authorizationReceiptId).toBe(receipt.receiptId);
    expect(er.actualActionDigest).toBe(actionDigest(action));
    expect(er.externalReference).toBe('tx_1');
    expect(verifyExecutionReceiptSignature(er, execSigner.publicKeyRaw)).toBe(true);
  });

  test('action substitution is refused — handler never runs, REJECTED ACTION_MISMATCH', async () => {
    let ran = 0;
    const tampered: CanonicalAction = { ...action, parameters: { ...action.parameters, amount: 9_999_999 } };
    const out = await executor.execute({
      action: tampered, // receipt authorized amount 500, executor is asked to run 9,999,999
      contextDigest: CTX,
      receipt,
      handler: async () => {
        ran++;
        return 'sent';
      },
    });
    expect(ran).toBe(0);
    expect(out.status).toBe(ExecutionStatus.Rejected);
    expect((out.error as { code?: string }).code).toBe(ProtocolErrorCode.ActionMismatch);
    expect(out.executionReceipt.executionStatus).toBe(ExecutionStatus.Rejected);
  });

  test('replay is refused — the same receipt cannot drive two executions', async () => {
    const first = await executor.execute({ action, contextDigest: CTX, receipt, handler: async () => 'ok' });
    expect(first.status).toBe(ExecutionStatus.Succeeded);
    let ran = 0;
    const second = await executor.execute({
      action,
      contextDigest: CTX,
      receipt,
      handler: async () => {
        ran++;
        return 'ok';
      },
    });
    expect(ran).toBe(0);
    expect(second.status).toBe(ExecutionStatus.Rejected);
    expect((second.error as { code?: string }).code).toBe(ProtocolErrorCode.ReplayDetected);
  });

  test('a handler that throws yields a signed FAILED receipt (execution failure ≠ authorization failure)', async () => {
    const out = await executor.execute({
      action,
      contextDigest: CTX,
      receipt,
      handler: async () => {
        throw new Error('downstream timeout');
      },
    });
    expect(out.status).toBe(ExecutionStatus.Failed);
    expect(out.error?.message).toMatch(/downstream timeout/);
    expect(out.executionReceipt.executionStatus).toBe(ExecutionStatus.Failed);
    expect(verifyExecutionReceiptSignature(out.executionReceipt, execSigner.publicKeyRaw)).toBe(true);
    // The slot was legitimately consumed; a retry with the same receipt is a replay.
    const retry = await executor.execute({ action, contextDigest: CTX, receipt, handler: async () => 'ok' });
    expect(retry.status).toBe(ExecutionStatus.Rejected);
  });
});
