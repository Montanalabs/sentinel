import { test, expect, describe } from 'vitest';
import { Signer } from '../provenance/signing.js';
import {
  CheckpointSigner,
  checkpointDigest,
  verifyCheckpointSignature,
  CHECKPOINT_GENESIS,
  type Checkpoint,
} from './checkpoint.js';
import { WebhookCheckpointPublisher } from './checkpoint-publishers.js';

const signer = Signer.fromSeed(Buffer.alloc(32, 5));
let n = 0;
const cp = new CheckpointSigner(signer, { issuer: 'gate', now: () => 1000, newId: () => `ckpt_${++n}` });
const digests = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];

describe('Checkpoint', () => {
  test('builds a signed checkpoint over an ordered range', () => {
    const c = cp.create({ sequenceStart: 0, sequenceEnd: 2, recordDigests: digests, previousCheckpointDigest: CHECKPOINT_GENESIS });
    expect(c.recordCount).toBe(3);
    expect(c.rootDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(c.previousCheckpointDigest).toBe(CHECKPOINT_GENESIS);
    expect(verifyCheckpointSignature(c, signer.publicKeyRaw)).toBe(true);
  });

  test('the root is order-sensitive (a reordered range gives a different root)', () => {
    const a = cp.create({ sequenceStart: 0, sequenceEnd: 2, recordDigests: digests, previousCheckpointDigest: CHECKPOINT_GENESIS });
    const b = cp.create({ sequenceStart: 0, sequenceEnd: 2, recordDigests: [...digests].reverse(), previousCheckpointDigest: CHECKPOINT_GENESIS });
    expect(a.rootDigest).not.toBe(b.rootDigest);
  });

  test('tampering with any field breaks the signature', () => {
    const c = cp.create({ sequenceStart: 0, sequenceEnd: 2, recordDigests: digests, previousCheckpointDigest: CHECKPOINT_GENESIS });
    expect(verifyCheckpointSignature({ ...c, rootDigest: 'd'.repeat(64) }, signer.publicKeyRaw)).toBe(false);
    expect(verifyCheckpointSignature({ ...c, sequenceEnd: 99 }, signer.publicKeyRaw)).toBe(false);
    expect(verifyCheckpointSignature({ ...c, previousCheckpointDigest: 'x' }, signer.publicKeyRaw)).toBe(false);
  });

  test('checkpoints chain via previousCheckpointDigest', () => {
    const c1 = cp.create({ sequenceStart: 0, sequenceEnd: 2, recordDigests: digests, previousCheckpointDigest: CHECKPOINT_GENESIS });
    const c2 = cp.create({ sequenceStart: 3, sequenceEnd: 3, recordDigests: ['e'.repeat(64)], previousCheckpointDigest: checkpointDigest(c1) });
    expect(c2.previousCheckpointDigest).toBe(checkpointDigest(c1));
  });
});

describe('WebhookCheckpointPublisher', () => {
  test('POSTs the checkpoint as JSON', async () => {
    let captured: { url: string; body: Checkpoint } | undefined;
    const fakeFetch = (async (url: string, init: { body: string }) => {
      captured = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    const c = cp.create({ sequenceStart: 0, sequenceEnd: 0, recordDigests: ['a'.repeat(64)], previousCheckpointDigest: CHECKPOINT_GENESIS });
    await new WebhookCheckpointPublisher('https://witness.example/cp', fakeFetch).publish(c);
    expect(captured?.url).toBe('https://witness.example/cp');
    expect(captured?.body.checkpointId).toBe(c.checkpointId);
  });

  test('rejects on a non-2xx witness response', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 503 }) as Response) as unknown as typeof fetch;
    const c = cp.create({ sequenceStart: 0, sequenceEnd: 0, recordDigests: ['a'.repeat(64)], previousCheckpointDigest: CHECKPOINT_GENESIS });
    await expect(new WebhookCheckpointPublisher('https://x', fakeFetch).publish(c)).rejects.toThrow(/503/);
  });
});
