/**
 * Structured verification evidence and its Merkle commitment.
 *
 * Each {@link EvidenceItem} is a tamper-evident record of one piece of ground truth the gate
 * consulted (a ledger balance, an EHR lookup, a sanctions list) — committed by digest, never by raw
 * value, so sensitive data is not embedded in receipts. The authorization receipt binds the whole
 * evidence set through a single {@link evidenceMerkleRoot}, letting an auditor later prove exactly
 * which evidence backed the decision and detect substitution.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical.js';
import { merkleRoot } from './merkle.js';

/** A single, digest-committed item of verification evidence. */
export interface EvidenceItem {
  /** Stable id of the source consulted. */
  readonly sourceId: string;
  /** Kind of source, e.g. `ledger`, `fhir`, `sanctions-list`. */
  readonly sourceType: string;
  /** SHA-256 of the canonical query issued to the source. */
  readonly queryDigest: string;
  /** SHA-256 of the canonical response (the raw response is NOT stored here). */
  readonly responseDigest: string;
  /** When the evidence was retrieved (ISO-8601). */
  readonly retrievedAt: string;
  /** Optional freshness bound (ISO-8601) past which the evidence is stale. */
  readonly freshnessLimit?: string;
  /** Optional signature from the source attesting the response. */
  readonly sourceSignature?: string;
  /** Optional digest of any transformation applied to the raw response. */
  readonly transformationDigest?: string;
  /** Trust classification of the source, e.g. `authoritative`, `advisory`. */
  readonly trustLevel: string;
  /** Whether the source was reachable, e.g. `available`, `unavailable`, `stale`. */
  readonly availabilityStatus: string;
}

/** The commitment a receipt carries over its evidence set. */
export interface EvidenceCommitment {
  readonly evidenceDigest: string;
  readonly count: number;
}

/** Deterministic SHA-256 digest of one evidence item (order-independent). */
export function evidenceItemDigest(item: EvidenceItem): string {
  return createHash('sha256').update(canonicalize(item)).digest('hex');
}

/**
 * Compute the Merkle root over an evidence set.
 *
 * Leaves are the per-item digests, sorted so the root commits to the *set* (independent of the
 * order evidence was gathered). An empty set yields the canonical empty root.
 *
 * @param items - The evidence items to commit to.
 * @returns The hex Merkle root.
 */
export function evidenceMerkleRoot(items: readonly EvidenceItem[]): string {
  return merkleRoot(items.map(evidenceItemDigest), { sort: true });
}

/**
 * Build an {@link EvidenceCommitment} for a receipt.
 *
 * @param items - The evidence set backing the decision.
 * @returns The Merkle root and item count.
 */
export function commitEvidence(items: readonly EvidenceItem[]): EvidenceCommitment {
  return { evidenceDigest: evidenceMerkleRoot(items), count: items.length };
}
