/**
 * Externally-publishable checkpoints over the tamper-evident record log.
 *
 * A {@link Checkpoint} is a signed commitment to a contiguous range of records (an ordered Merkle
 * root), chained to the previous checkpoint. Publishing checkpoints to an independent location (a
 * file, a webhook, later a transparency log or chain) lets an external party detect log truncation
 * or rewriting: a server cannot quietly drop or alter records once a checkpoint covering them has
 * been witnessed. The {@link CheckpointPublisher} abstraction is intentionally minimal so new sinks
 * can be added without touching this domain type.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical.js';
import type { Signer } from '../provenance/signing.js';
import { verifySignature } from '../provenance/signing.js';
import { merkleRoot } from './merkle.js';

/** `previousCheckpointDigest` of the first checkpoint in a chain. */
export const CHECKPOINT_GENESIS = 'GENESIS';

/** A signed commitment to an ordered range of log records. */
export interface Checkpoint {
  readonly checkpointId: string;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly recordCount: number;
  /** Ordered Merkle root over the records in `[sequenceStart, sequenceEnd]`. */
  readonly rootDigest: string;
  /** Digest of the previous checkpoint, or {@link CHECKPOINT_GENESIS}. */
  readonly previousCheckpointDigest: string;
  readonly createdAt: string;
  readonly issuer: string;
  readonly keyId: string;
  /** base64 Ed25519 signature over the canonical body (all fields except this one). */
  readonly signature: string;
}

type SignableCheckpoint = Omit<Checkpoint, 'signature'>;

/** Canonical signable body of a checkpoint (every field except `signature`). */
export function checkpointSignableBody(c: SignableCheckpoint): string {
  return canonicalize({
    checkpointId: c.checkpointId,
    sequenceStart: c.sequenceStart,
    sequenceEnd: c.sequenceEnd,
    recordCount: c.recordCount,
    rootDigest: c.rootDigest,
    previousCheckpointDigest: c.previousCheckpointDigest,
    createdAt: c.createdAt,
    issuer: c.issuer,
    keyId: c.keyId,
  });
}

function checkpointSigningInput(c: SignableCheckpoint): Buffer {
  return createHash('sha256').update(checkpointSignableBody(c)).digest();
}

/** Stable digest of a checkpoint (SHA-256 of its signable body, hex) — used to chain the next one. */
export function checkpointDigest(c: SignableCheckpoint): string {
  return createHash('sha256').update(checkpointSignableBody(c)).digest('hex');
}

/** Verify a checkpoint's signature against a trusted public key. */
export function verifyCheckpointSignature(c: Checkpoint, publicKeyRaw: Buffer): boolean {
  try {
    return verifySignature(publicKeyRaw, checkpointSigningInput(c), Buffer.from(c.signature, 'base64'));
  } catch {
    return false;
  }
}

/** Inputs to mint a checkpoint over a record range. */
export interface CheckpointInput {
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  /** Per-record digests (e.g. provenance `contentHash`es) in ascending sequence order. */
  readonly recordDigests: readonly string[];
  /** Digest of the prior checkpoint, or {@link CHECKPOINT_GENESIS} for the first. */
  readonly previousCheckpointDigest: string;
}

/** Signs {@link Checkpoint}s for one issuer identity. */
export class CheckpointSigner {
  readonly #signer: Signer;
  readonly #issuer: string;
  readonly #now: () => number;
  readonly #newId: () => string;

  constructor(signer: Signer, opts: { issuer: string; now?: () => number; newId: () => string }) {
    this.#signer = signer;
    this.#issuer = opts.issuer;
    this.#now = opts.now ?? Date.now;
    this.#newId = opts.newId;
  }

  /** Key id of the signer; pin checkpoint verification to it. */
  get keyId(): string {
    return this.#signer.keyId;
  }

  /** Build and sign a checkpoint over `input`'s record range. */
  create(input: CheckpointInput): Checkpoint {
    const base: SignableCheckpoint = {
      checkpointId: this.#newId(),
      sequenceStart: input.sequenceStart,
      sequenceEnd: input.sequenceEnd,
      recordCount: input.recordDigests.length,
      rootDigest: merkleRoot(input.recordDigests, { sort: false }), // ordered: sequence commitment
      previousCheckpointDigest: input.previousCheckpointDigest,
      createdAt: new Date(this.#now()).toISOString(),
      issuer: this.#issuer,
      keyId: this.#signer.keyId,
    };
    const signature = this.#signer.sign(checkpointSigningInput(base)).toString('base64');
    return { ...base, signature };
  }
}

/** Sink that publishes checkpoints to an external location for independent witnessing. */
export interface CheckpointPublisher {
  /** Publish a checkpoint; rejects if the sink is unreachable. */
  publish(checkpoint: Checkpoint): Promise<void>;
}
