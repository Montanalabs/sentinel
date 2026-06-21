/**
 * Ed25519 signing primitives for the provenance log.
 *
 * Provides the {@link Signer} identity used by {@link RecordBuilder} to sign each
 * {@link ProvenanceRecord}, plus a standalone {@link verifySignature} for replaying signatures
 * during {@link verifyRecord}/{@link verifyChain}. Keys are handled in their compact 32-byte raw
 * form at the boundary and wrapped into DER (SPKI/PKCS#8) only when handed to Node's crypto API.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
  type KeyObject,
} from 'node:crypto';

// DER prefixes for Ed25519 (RFC 8410).
const PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex'); // + 32-byte seed
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // + 32-byte raw pubkey

function rawToSpki(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

function spkiToRaw(pub: KeyObject): Buffer {
  const der = pub.export({ format: 'der', type: 'spki' });
  return Buffer.from(der.subarray(der.length - 32));
}

/**
 * Derive the stable key id for a raw Ed25519 public key.
 *
 * The id is `ed25519:` + the **full** SHA-256 of the key (64 hex). Because it is a pure, collision-
 * resistant function of the key, {@link verifyRecord} can recompute it to assert a record's claimed
 * `keyId` actually belongs to its embedded `signerPublicKey`. The full digest (not a truncated
 * fingerprint) is deliberate: chain verification trusts a record by `keyId` membership and then
 * checks the embedded key, so a truncated id would let a store-write attacker forge a key colliding
 * a trusted id at feasible work — with the full hash that requires a SHA-256 second preimage (~2²⁵⁶).
 *
 * @param raw - The 32-byte raw Ed25519 public key.
 * @returns The `ed25519:<hex64>` key id.
 */
export function keyIdFor(raw: Buffer): string {
  return 'ed25519:' + createHash('sha256').update(raw).digest('hex');
}

/**
 * An Ed25519 signing identity used to sign provenance records.
 *
 * Holds a private key plus its derived public material; the private key never leaves the
 * instance. Construct one via {@link Signer.fromSeed} (deterministic) or
 * {@link Signer.generate} (random), then pass it to a {@link RecordBuilder}.
 *
 * @remarks `keyId` is a short, stable fingerprint of the public key (`ed25519:` + first 16 hex
 *   chars of its SHA-256), suitable for tagging records and matching signers across a chain.
 */
export class Signer {
  private constructor(
    private readonly privateKey: KeyObject,
    readonly publicKeyRaw: Buffer,
    readonly keyId: string,
  ) {}

  /**
   * Build a deterministic {@link Signer} from a fixed seed.
   *
   * The same seed always yields the same key pair and {@link Signer.keyId}, so this is the path
   * for reproducible or persisted identities (and for tests).
   *
   * @param seed - The Ed25519 private seed; must be exactly 32 bytes.
   * @returns A signer whose identity is fully determined by `seed`.
   * @throws {Error} If `seed` is not exactly 32 bytes long.
   */
  static fromSeed(seed: Buffer): Signer {
    if (seed.length !== 32) throw new Error('Ed25519 seed must be exactly 32 bytes');
    const privateKey = createPrivateKey({
      key: Buffer.concat([PKCS8_SEED_PREFIX, seed]),
      format: 'der',
      type: 'pkcs8',
    });
    const raw = spkiToRaw(createPublicKey(privateKey));
    return new Signer(privateKey, raw, keyIdFor(raw));
  }

  /**
   * Build a {@link Signer} from a freshly generated random key pair.
   *
   * The resulting identity is ephemeral unless the caller persists the underlying seed
   * separately; for a recoverable identity use {@link Signer.fromSeed} instead.
   *
   * @returns A signer backed by a new random Ed25519 key pair.
   */
  static generate(): Signer {
    const { privateKey } = generateKeyPairSync('ed25519');
    const raw = spkiToRaw(createPublicKey(privateKey));
    return new Signer(privateKey, raw, keyIdFor(raw));
  }

  /**
   * Produce a detached Ed25519 signature over arbitrary bytes.
   *
   * Used by {@link RecordBuilder} to sign a record's content hash; the resulting signature is
   * later checked with {@link verifySignature} using {@link Signer.publicKeyRaw}.
   *
   * @param data - The exact bytes to sign (for provenance records, the raw content-hash bytes).
   * @returns The raw 64-byte Ed25519 signature.
   */
  sign(data: Buffer): Buffer {
    return cryptoSign(null, data, this.privateKey);
  }
}

/**
 * Verify an Ed25519 signature against the signed bytes and a raw public key.
 *
 * The counterpart to {@link Signer.sign}: it wraps the compact public key into SPKI form and
 * checks the signature. Any malformed key or signature is treated as a verification failure
 * rather than an exception, so callers such as {@link verifyRecord} can branch on the boolean.
 *
 * @param publicKeyRaw - The 32-byte raw Ed25519 public key of the alleged signer.
 * @param data - The exact bytes that were signed.
 * @param signature - The raw 64-byte signature to check.
 * @returns `true` if the signature is valid for `data` under `publicKeyRaw`; `false` on mismatch
 *   or on any malformed/invalid input.
 */
export function verifySignature(publicKeyRaw: Buffer, data: Buffer, signature: Buffer): boolean {
  try {
    return cryptoVerify(null, data, rawToSpki(publicKeyRaw), signature);
  } catch {
    return false;
  }
}
