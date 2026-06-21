import { test, expect, describe } from 'vitest';
import { Signer } from './signing.js';
import { RecordBuilder, verifyRecord, verifyChain, verifyChainPaged, GENESIS } from './record.js';
import { Action } from '../core/action.js';
import { Verdict, CheckOutcome } from '../core/types.js';
import type { CheckResult } from '../core/types.js';

const checks: CheckResult[] = [
  { check: 'schema', outcome: CheckOutcome.Pass, verdict: Verdict.Allow },
  { check: 'policy', outcome: CheckOutcome.Pass, verdict: Verdict.Allow },
];

function builder(): RecordBuilder {
  return new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 11)));
}

function input(verdict: Verdict = Verdict.Allow) {
  return {
    action: Action.payment({ amount: 100, from: 'a', to: 'b' }, { id: 'act_1' }),
    context: { runId: 'run_1', provider: 'anthropic', model: 'claude-sonnet-4-6' },
    checks,
    verdict,
  };
}

describe('RecordBuilder hash-chain', () => {
  test('first record links to GENESIS at seq 0', () => {
    const r = builder().append(input(), '2026-06-13T00:00:00.000Z');
    expect(r.prevHash).toBe(GENESIS);
    expect(r.seq).toBe(0);
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.verdict).toBe(Verdict.Allow);
  });

  test('second record chains to the first and increments seq', () => {
    const b = builder();
    const r0 = b.append(input(), '2026-06-13T00:00:00.000Z');
    const r1 = b.append(input(Verdict.Block), '2026-06-13T00:00:01.000Z');
    expect(r1.prevHash).toBe(r0.contentHash);
    expect(r1.seq).toBe(1);
  });

  test('record carries signer keyId and public key', () => {
    const r = builder().append(input(), '2026-06-13T00:00:00.000Z');
    expect(r.keyId).toMatch(/^ed25519:[0-9a-f]{16}$/);
    expect(typeof r.signerPublicKey).toBe('string');
    expect(typeof r.sig).toBe('string');
  });
});

describe('verifyRecord', () => {
  test('accepts a freshly built record', () => {
    const r = builder().append(input(), '2026-06-13T00:00:00.000Z');
    expect(verifyRecord(r)).toEqual({ ok: true });
  });

  test('rejects a record whose verdict was tampered', () => {
    const r = builder().append(input(Verdict.Allow), '2026-06-13T00:00:00.000Z');
    const tampered = { ...r, verdict: Verdict.Block };
    expect(verifyRecord(tampered).ok).toBe(false);
  });

  test('rejects a record whose action payload was tampered', () => {
    const r = builder().append(input(), '2026-06-13T00:00:00.000Z');
    const tampered = { ...r, action: { ...r.action, payload: { amount: 999999, from: 'a', to: 'b' } } };
    expect(verifyRecord(tampered).ok).toBe(false);
  });

  test('rejects a record whose signature was tampered', () => {
    const r = builder().append(input(), '2026-06-13T00:00:00.000Z');
    const badSig = Buffer.from(r.sig, 'base64');
    badSig[0] = (badSig[0] ?? 0) ^ 0xff;
    expect(verifyRecord({ ...r, sig: badSig.toString('base64') }).ok).toBe(false);
  });
});

describe('verifyChain', () => {
  test('accepts a valid chain', () => {
    const b = builder();
    const rs = [
      b.append(input(), '2026-06-13T00:00:00.000Z'),
      b.append(input(Verdict.Escalate), '2026-06-13T00:00:01.000Z'),
      b.append(input(Verdict.Block), '2026-06-13T00:00:02.000Z'),
    ];
    expect(verifyChain(rs)).toEqual({ ok: true });
  });

  test('detects a broken link (mutated middle record)', () => {
    const b = builder();
    const rs = [
      b.append(input(), '2026-06-13T00:00:00.000Z'),
      b.append(input(), '2026-06-13T00:00:01.000Z'),
      b.append(input(), '2026-06-13T00:00:02.000Z'),
    ];
    rs[1] = { ...rs[1]!, verdict: Verdict.Block };
    const res = verifyChain(rs);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(1);
  });

  test('detects a deleted record (chain discontinuity)', () => {
    const b = builder();
    const rs = [
      b.append(input(), '2026-06-13T00:00:00.000Z'),
      b.append(input(), '2026-06-13T00:00:01.000Z'),
      b.append(input(), '2026-06-13T00:00:02.000Z'),
    ];
    const withGap = [rs[0]!, rs[2]!];
    const res = verifyChain(withGap);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(1);
  });

  test('empty chain is trivially valid', () => {
    expect(verifyChain([])).toEqual({ ok: true });
  });
});

describe('verifyChain — signer pinning (forgery resistance)', () => {
  test('a chain re-signed under an attacker key FAILS when pinned to the real signer', () => {
    // Legit chain from the real signer.
    const real = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 11)));
    const legit = [
      real.append(input(Verdict.Block), '2026-06-13T00:00:00.000Z'),
      real.append(input(Verdict.Block), '2026-06-13T00:00:01.000Z'),
    ];
    // Attacker with store write access rebuilds the whole chain under THEIR own key,
    // flipping the verdicts to Allow. It is internally consistent and self-signed.
    const attacker = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 99)));
    const forged = [
      attacker.append(input(Verdict.Allow), '2026-06-13T00:00:00.000Z'),
      attacker.append(input(Verdict.Allow), '2026-06-13T00:00:01.000Z'),
    ];

    // Without pinning the forged chain looks "internally consistent"...
    expect(verifyChain(forged).ok).toBe(true);
    // ...but pinned to the real signer it must be rejected as untrusted.
    const pinned = verifyChain(forged, [real.keyId]);
    expect(pinned.ok).toBe(false);
    expect(pinned.reason).toMatch(/untrusted signer/);
    // The genuine chain still passes under the same pin.
    expect(verifyChain(legit, [real.keyId])).toEqual({ ok: true });
  });

  test('rejects a record whose keyId was spoofed (keyId is bound by the content hash)', () => {
    const r = builder().append(input(), '2026-06-13T00:00:00.000Z');
    // Forge a trusted-looking keyId while leaving the real key in place — caught by the hash,
    // since keyId is part of the signed body.
    expect(verifyRecord({ ...r, keyId: 'ed25519:0000000000000000' }).ok).toBe(false);
  });

  test('rejects a record whose public key was swapped (signerPublicKey is bound by the hash)', () => {
    const r = builder().append(input(), '2026-06-13T00:00:00.000Z');
    const other = Signer.fromSeed(Buffer.alloc(32, 77));
    const swapped = { ...r, signerPublicKey: other.publicKeyRaw.toString('base64'), keyId: other.keyId };
    expect(verifyRecord(swapped).ok).toBe(false);
  });
});

describe('verifyChainPaged (bounded-memory verification)', () => {
  function chainOf(n: number) {
    const b = builder();
    const rs = [];
    for (let i = 0; i < n; i++) rs.push(b.append(input(), `2026-06-13T00:00:0${i}.000Z`));
    return { rs, keyId: b.keyId };
  }
  async function* paged(rs: readonly unknown[], size: number) {
    for (let i = 0; i < rs.length; i += size) yield rs.slice(i, i + size) as never;
  }

  test('matches verifyChain across page boundaries', async () => {
    const { rs, keyId } = chainOf(5);
    expect(await verifyChainPaged(paged(rs, 2), [keyId])).toEqual({ ok: true });
  });

  test('detects a broken link that spans pages', async () => {
    const { rs, keyId } = chainOf(5);
    rs[2] = { ...rs[2]!, verdict: Verdict.Block }; // tamper at a page boundary
    const res = await verifyChainPaged(paged(rs, 2), [keyId]);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(2);
  });

  test('rejects an untrusted-signer chain when pinned', async () => {
    const { rs } = chainOf(3);
    expect((await verifyChainPaged(paged(rs, 2), ['ed25519:deadbeefdeadbeef'])).ok).toBe(false);
  });
});
