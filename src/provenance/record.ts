/**
 * Hash-chained, signed provenance records and their verification.
 *
 * This file defines the on-disk/over-the-wire shape of a provenance entry
 * ({@link ProvenanceRecord}), the {@link RecordBuilder} that links and signs entries into a
 * tamper-evident chain, and the {@link verifyRecord}/{@link verifyChain} replay checks. It sits
 * at the trust boundary of the gate: every guarded {@link Action} and its {@link Verdict} are
 * captured here so the decision log can later be proven intact.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { Action, CheckResult, Verdict } from '../core/types.js';
import { canonicalize } from '../core/canonical.js';
import { actionFingerprint } from '../core/action.js';
import { Signer, verifySignature, keyIdFor } from './signing.js';

/**
 * Sentinel `prevHash` value of the first record in a chain.
 *
 * Marks the genesis link: {@link RecordBuilder} starts here and {@link verifyChain} expects the
 * record at sequence 0 to carry this as its `prevHash`.
 */
export const GENESIS = 'GENESIS';

/**
 * Compact, signable summary of the agent context behind an action.
 *
 * Identifies which run/model/actor produced the {@link Action} being recorded. Kept minimal so
 * it can be embedded verbatim in a {@link ProvenanceRecord} and covered by its content hash.
 *
 * @remarks `provider`, `model`, and `actor` are optional because not every caller has agent
 *   metadata; omit them rather than passing placeholders, since their presence is part of the
 *   signed body.
 */
export interface RecordContext {
  readonly runId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly actor?: { readonly id: string; readonly roles?: readonly string[] };
}

/**
 * Caller-supplied payload for a single provenance entry, before the chain stamps it.
 *
 * The content-bearing inputs {@link RecordBuilder.append} consumes to mint a
 * {@link ProvenanceRecord}: the {@link Action}, its {@link RecordContext}, the
 * {@link CheckResult}s that fed the {@link Verdict}, and an optional escalation reference. The
 * builder supplies all chain/identity/hash/signature fields itself.
 */
export interface RecordInput {
  readonly tenant?: string;
  readonly action: Action;
  readonly context: RecordContext;
  readonly checks: readonly CheckResult[];
  readonly verdict: Verdict;
  readonly reason?: string;
  readonly escalationId?: string;
}

/**
 * An immutable, hash-chained, signed entry in the provenance log.
 *
 * Extends the caller's {@link RecordInput} with the fields {@link RecordBuilder.append} stamps:
 * identity (`id`, `ts`, `seq`), the chain link (`prevHash`), integrity (`actionFingerprint`,
 * `contentHash`), and the signer's identity/signature (`keyId`, `signerPublicKey`, `sig`). Any
 * mutation breaks {@link verifyRecord}; reordering or gaps break {@link verifyChain}.
 *
 * @remarks `contentHash` is the SHA-256 (hex) of the canonicalized signable body and doubles as
 *   the next record's `prevHash`. `sig` is the Ed25519 signature over those content-hash bytes.
 */
export interface ProvenanceRecord extends RecordInput {
  readonly id: string;
  readonly ts: string;
  readonly seq: number;
  readonly prevHash: string;
  readonly actionFingerprint: string;
  readonly contentHash: string;
  readonly keyId: string;
  /** base64 raw Ed25519 public key of the signer. */
  readonly signerPublicKey: string;
  /** base64 Ed25519 signature over contentHash. */
  readonly sig: string;
}

/**
 * The fields that are hashed (everything content-bearing except the hash/sig themselves).
 *
 * `signerPublicKey` is included so the signing key is bound by the content hash: an attacker
 * cannot swap in a different public key without invalidating the hash (and thus the signature).
 */
function recordBody(r: Omit<ProvenanceRecord, 'contentHash' | 'sig'>): string {
  return canonicalize({
    id: r.id,
    ts: r.ts,
    seq: r.seq,
    prevHash: r.prevHash,
    tenant: r.tenant,
    action: { type: r.action.type, payload: r.action.payload, meta: r.action.meta },
    actionFingerprint: r.actionFingerprint,
    context: r.context,
    checks: r.checks,
    verdict: r.verdict,
    reason: r.reason,
    escalationId: r.escalationId,
    keyId: r.keyId,
    signerPublicKey: r.signerPublicKey,
  });
}

function computeContentHash(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Builds a linked, signed chain of {@link ProvenanceRecord}s from a single {@link Signer}.
 *
 * Stateful and append-only: it tracks the running `prevHash` and `seq` so successive calls to
 * {@link RecordBuilder.append} form a tamper-evident chain starting at {@link GENESIS}. One
 * builder corresponds to one logical chain; use {@link RecordBuilder.resume} to continue a chain
 * that was persisted across restarts.
 *
 * @remarks Not safe for concurrent appends — serialize calls, since `prevHash`/`seq` advance per
 *   record.
 */
export class RecordBuilder {
  private prevHash = GENESIS;
  private seq = 0;

  /**
   * Create a builder that signs every appended record with `signer`.
   *
   * @param signer - The Ed25519 identity whose {@link Signer.keyId} and public key are stamped
   *   into each record.
   */
  constructor(private readonly signer: Signer) {}

  /** Key id of the signer stamped into every record this builder appends; use to pin verification. */
  get keyId(): string {
    return this.signer.keyId;
  }

  /** Snapshot of the builder's chain cursor — capture before an append to restore on failure. */
  get cursor(): { readonly prevHash: string; readonly seq: number } {
    return { prevHash: this.prevHash, seq: this.seq };
  }

  /**
   * Resume an existing chain from its persisted tail (e.g. on sidecar restart).
   *
   * Rewinds the builder's internal cursor so the next {@link RecordBuilder.append} links onto an
   * already-persisted record instead of starting a fresh chain at {@link GENESIS}.
   *
   * @param prevHash - The `contentHash` of the last persisted record to chain onto.
   * @param nextSeq - The sequence number to assign to the next appended record.
   */
  resume(prevHash: string, nextSeq: number): void {
    this.prevHash = prevHash;
    this.seq = nextSeq;
  }

  /**
   * Mint, link, and sign the next {@link ProvenanceRecord} in the chain.
   *
   * Stamps identity and chain fields onto `input`, computes the canonical content hash, signs it
   * with the configured {@link Signer}, and advances the builder's cursor so the next call links
   * onto this record.
   *
   * @param input - The caller-supplied {@link RecordInput} for this entry.
   * @param ts - ISO-8601 timestamp to record; defaults to the current time. Pass an explicit
   *   value for deterministic/reproducible records.
   * @returns The fully sealed record, ready to persist and verify with {@link verifyRecord}.
   */
  append(input: RecordInput, ts: string = new Date().toISOString()): ProvenanceRecord {
    const base = {
      ...input,
      id: `rec_${randomUUID()}`,
      ts,
      seq: this.seq,
      prevHash: this.prevHash,
      actionFingerprint: actionFingerprint(input.action),
      keyId: this.signer.keyId,
      signerPublicKey: this.signer.publicKeyRaw.toString('base64'),
    };
    const contentHash = computeContentHash(recordBody(base));
    const sig = this.signer.sign(Buffer.from(contentHash, 'hex')).toString('base64');
    const record: ProvenanceRecord = {
      ...base,
      contentHash,
      sig,
    };
    this.prevHash = contentHash;
    this.seq += 1;
    return record;
  }
}

/**
 * Outcome of a {@link verifyRecord} or {@link verifyChain} check.
 *
 * A successful result is just `{ ok: true }`; on failure `reason` carries a human-readable cause
 * and, for chain checks, `brokenAt` is the index of the first offending record.
 *
 * @remarks `brokenAt` is set only by {@link verifyChain}; single-record checks leave it absent.
 */
export interface VerifyResult {
  ok: boolean;
  reason?: string;
  brokenAt?: number;
}

/**
 * The set of signer identities a verification will trust.
 *
 * Pass the `keyId`(s) of the signer(s) you expect (e.g. the sidecar's configured signer). When
 * provided, {@link verifyRecord}/{@link verifyChain} reject any record signed by a key outside
 * this set — even if that record is internally consistent and correctly self-signed.
 *
 * @remarks Omitting trusted keys only proves a record is *internally consistent* ("someone signed
 *   it"), NOT that *your* signer signed it. A holder of write access to the store can otherwise
 *   regenerate an entire chain under their own key and have it verify. Always pin in production.
 */
export type TrustedKeyIds = ReadonlySet<string> | readonly string[];

function isTrusted(keyId: string, trusted?: TrustedKeyIds): boolean {
  if (trusted === undefined) return true;
  return Array.isArray(trusted) ? trusted.includes(keyId) : (trusted as ReadonlySet<string>).has(keyId);
}

/**
 * Verify one record's integrity in isolation, independent of its chain.
 *
 * Recomputes the canonical content hash, asserts the record's `keyId` actually derives from its
 * embedded `signerPublicKey` (no key/keyId mismatch), optionally checks the signer is trusted, and
 * replays the Ed25519 signature via {@link verifySignature}. Does not check linkage or ordering —
 * use {@link verifyChain} for that.
 *
 * @param r - The {@link ProvenanceRecord} to check.
 * @param trustedKeyIds - When provided, the record's `keyId` must be in this set or verification
 *   fails with an untrusted-signer reason. Omit only for "internal consistency" checks — see
 *   {@link TrustedKeyIds}.
 * @returns `{ ok: true }` if the record is intact, correctly self-bound, trusted, and signed;
 *   otherwise `ok: false` with a `reason`.
 */
export function verifyRecord(r: ProvenanceRecord, trustedKeyIds?: TrustedKeyIds): VerifyResult {
  const expected = computeContentHash(recordBody(r));
  if (expected !== r.contentHash) {
    return { ok: false, reason: 'content hash mismatch (record was modified)' };
  }
  // The keyId must actually belong to the embedded public key, or a forger could pair any key
  // with a trusted-looking keyId. (signerPublicKey is bound by the content hash above.)
  let publicKeyRaw: Buffer;
  try {
    publicKeyRaw = Buffer.from(r.signerPublicKey, 'base64');
    if (keyIdFor(publicKeyRaw) !== r.keyId) {
      return { ok: false, reason: 'keyId does not match signerPublicKey' };
    }
  } catch {
    return { ok: false, reason: 'malformed signerPublicKey' };
  }
  if (!isTrusted(r.keyId, trustedKeyIds)) {
    return { ok: false, reason: `untrusted signer (${r.keyId})` };
  }
  const sigOk = verifySignature(publicKeyRaw, Buffer.from(r.contentHash, 'hex'), Buffer.from(r.sig, 'base64'));
  if (!sigOk) return { ok: false, reason: 'signature verification failed' };
  return { ok: true };
}

/**
 * Verify an ordered chain of records end to end.
 *
 * For each record it runs {@link verifyRecord} for content/signature integrity, then checks the
 * chain invariants: `prevHash` must equal the previous record's `contentHash` (starting from
 * {@link GENESIS}) and `seq` must equal the record's position. The first violation stops the scan
 * and is reported via `brokenAt`.
 *
 * @param records - The records in ascending sequence order; index must match each record's `seq`.
 * @param trustedKeyIds - When provided, every record must be signed by a key in this set;
 *   otherwise verification fails. Omit only for internal-consistency checks — see
 *   {@link TrustedKeyIds}. Production callers (e.g. `/v1/verify`) should pin to the sidecar signer.
 * @returns `{ ok: true }` if every record is intact, trusted, and correctly linked; otherwise
 *   `ok: false` with `brokenAt` set to the failing index and a `reason`.
 */
export function verifyChain(records: readonly ProvenanceRecord[], trustedKeyIds?: TrustedKeyIds): VerifyResult {
  let prev = GENESIS;
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const step = verifyChainStep(r, prev, i, trustedKeyIds);
    if (!step.ok) return step;
    prev = r.contentHash;
  }
  return { ok: true };
}

/** Verify a single record against the running chain cursor (`prev` hash, expected `index`). */
function verifyChainStep(r: ProvenanceRecord, prev: string, index: number, trustedKeyIds?: TrustedKeyIds): VerifyResult {
  const single = verifyRecord(r, trustedKeyIds);
  if (!single.ok) return { ok: false, brokenAt: index, ...(single.reason ? { reason: single.reason } : {}) };
  if (r.prevHash !== prev) return { ok: false, brokenAt: index, reason: 'broken chain link (prevHash mismatch)' };
  if (r.seq !== index) return { ok: false, brokenAt: index, reason: `sequence gap (expected ${index}, got ${r.seq})` };
  return { ok: true };
}

/**
 * Verify a chain supplied as an async sequence of pages, in constant memory.
 *
 * Equivalent to {@link verifyChain} but never materializes the whole chain at once — the caller
 * yields fixed-size batches (e.g. the sidecar pages the store), so `/v1/verify` over a very long
 * chain cannot exhaust memory. Pages must be in ascending `seq` order and contiguous across the
 * boundary.
 *
 * @param pages - Async iterable of record batches, ascending by `seq`.
 * @param trustedKeyIds - Pinned signer set (see {@link verifyChain}).
 * @returns `{ ok: true }` if the whole streamed chain verifies; otherwise the first failure.
 */
export async function verifyChainPaged(
  pages: AsyncIterable<readonly ProvenanceRecord[]>,
  trustedKeyIds?: TrustedKeyIds,
): Promise<VerifyResult> {
  let prev = GENESIS;
  let index = 0;
  for await (const page of pages) {
    for (const r of page) {
      const step = verifyChainStep(r, prev, index, trustedKeyIds);
      if (!step.ok) return step;
      prev = r.contentHash;
      index++;
    }
  }
  return { ok: true };
}
