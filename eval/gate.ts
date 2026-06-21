/**
 * Wires a real Sentinel stack for the evaluation — no mocks of the components under test.
 *
 * {@link buildGate} assembles the production {@link Engine} (with two real {@link Check}s), the
 * {@link Adjudicator}, the {@link ReceiptValidator}, and the {@link ProtectedExecutor} over in-memory
 * stores, plus a *stranger* issuer whose receipts are signed by an untrusted key (used to model the
 * forged-authorization attack). A fresh gate is built per attack attempt so nonce/receipt state never
 * leaks between attempts. The clock is fixed so issued receipts are valid for the duration of a run.
 */

import { Verdict, CheckOutcome } from '../src/core/types.js';
import { CheckTier, type Check, type CheckInput } from '../src/checks/types.js';
import type { CheckResult } from '../src/core/types.js';
import { Engine } from '../src/engine/engine.js';
import { RecordBuilder } from '../src/provenance/record.js';
import { InMemoryStore } from '../src/store/memory.js';
import { Signer } from '../src/provenance/signing.js';
import { ReceiptIssuer } from '../src/protocol/receipt-issuer.js';
import { ReceiptValidator } from '../src/protocol/receipt-validator.js';
import { Adjudicator } from '../src/protocol/adjudicator.js';
import { ProtectedExecutor } from '../src/protocol/protected-executor.js';
import { ExecutionReceiptSigner } from '../src/protocol/execution-receipt.js';
import { InMemoryRevocationStore } from '../src/protocol/revocation-store.js';
import { InMemoryNonceStore } from '../src/store/nonce-memory.js';
import { EVAL_POLICY_ID } from './scenarios.js';

/** Fixed wall clock (2025-01-01T00:00:00Z) so issued receipts stay valid through a run. */
export const FIXED_NOW = Date.parse('2025-01-01T00:00:00.000Z');

/** Always-pass structural check (stands in for schema validation). */
const schemaCheck: Check = {
  name: 'schema',
  tier: CheckTier.Fast,
  async run(): Promise<CheckResult> {
    return { check: 'schema', outcome: CheckOutcome.Pass, verdict: Verdict.Allow };
  },
};

/** Real deterministic policy check: blocks any action whose payload carries `forbidden: true`. */
const forbiddenCheck: Check = {
  name: 'forbidden',
  tier: CheckTier.Fast,
  async run(input: CheckInput): Promise<CheckResult> {
    const forbidden = input.action.payload['forbidden'] === true;
    return forbidden
      ? { check: 'forbidden', outcome: CheckOutcome.Fail, verdict: Verdict.Block, reason: 'payload marked forbidden' }
      : { check: 'forbidden', outcome: CheckOutcome.Pass, verdict: Verdict.Allow };
  },
};

/** A fully-wired real gate for one attack attempt. */
export interface EvalGate {
  readonly engine: Engine;
  readonly adjudicator: Adjudicator;
  readonly validator: ReceiptValidator;
  readonly executor: ProtectedExecutor;
  readonly issuer: ReceiptIssuer;
  /** Issuer signing with an UNTRUSTED key — its receipts model a forged authorization. */
  readonly strangerIssuer: ReceiptIssuer;
  readonly executionSigner: ExecutionReceiptSigner;
  readonly trustedAuthKeys: ReadonlyMap<string, Buffer>;
  readonly trustedExecKeys: ReadonlyMap<string, Buffer>;
}

const gateSigner = Signer.fromSeed(Buffer.alloc(32, 1));
const execSigner = Signer.fromSeed(Buffer.alloc(32, 2));
const strangerSigner = Signer.fromSeed(Buffer.alloc(32, 3));
const now = (): number => FIXED_NOW;

let execId = 0;

/**
 * Build a fresh, fully-wired real gate (engine + adjudicator + validator + executor).
 *
 * @returns A gate with clean in-memory nonce/provenance state for a single attack attempt.
 */
export function buildGate(): EvalGate {
  const builder = new RecordBuilder(gateSigner);
  const engine = new Engine({
    resolve: (id) => (id === EVAL_POLICY_ID ? [schemaCheck, forbiddenCheck] : []),
    builder,
    store: new InMemoryStore(),
  });
  const issuer = new ReceiptIssuer(gateSigner, { issuer: 'eval-gate', now });
  const strangerIssuer = new ReceiptIssuer(strangerSigner, { issuer: 'rogue', now });
  const revocations = new InMemoryRevocationStore();
  const trustedAuthKeys = new Map<string, Buffer>([[gateSigner.keyId, gateSigner.publicKeyRaw]]);
  const trustedExecKeys = new Map<string, Buffer>([[execSigner.keyId, execSigner.publicKeyRaw]]);
  const validator = new ReceiptValidator({ trustedKeys: trustedAuthKeys, nonceStore: new InMemoryNonceStore(), revocations, now });
  const executionSigner = new ExecutionReceiptSigner(execSigner, 'eval-exec', () => `exec_${(execId += 1)}`);
  const executor = new ProtectedExecutor(validator, executionSigner, { now });
  const adjudicator = new Adjudicator({ engine, issuer });
  return { engine, adjudicator, validator, executor, issuer, strangerIssuer, executionSigner, trustedAuthKeys, trustedExecKeys };
}
