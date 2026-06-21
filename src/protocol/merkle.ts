/**
 * Binary Merkle root over a list of hex leaf digests.
 *
 * Shared by the evidence-set commitment (which sorts leaves to commit to a *set*) and the audit
 * checkpoints (which preserve leaf order to commit to an ordered *sequence*).
 *
 * Domain separation: leaves are hashed with a `0x00` prefix and internal nodes with `0x01`, so a leaf
 * digest can never be reinterpreted as an internal node (or vice versa). An odd node is **promoted
 * unchanged** to the next level rather than duplicated, which avoids the CVE-2012-2459 ambiguity where
 * two distinct leaf sets hash to the same root. An empty input yields the SHA-256 of empty.
 */

import { createHash } from 'node:crypto';

const EMPTY_ROOT = createHash('sha256').update('').digest('hex');

/** Hash a leaf with the `0x00` domain-separation prefix. */
function hashLeaf(hex: string): string {
  return createHash('sha256').update(Buffer.concat([Buffer.from([0x00]), Buffer.from(hex, 'hex')])).digest('hex');
}

/** Hash an internal node (two child digests) with the `0x01` domain-separation prefix. */
function hashNode(left: string, right: string): string {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from([0x01]), Buffer.from(left, 'hex'), Buffer.from(right, 'hex')]))
    .digest('hex');
}

/**
 * Compute the Merkle root of `leaves`.
 *
 * @param leaves - Lowercase hex leaf digests.
 * @param opts.sort - When true, sort leaves first (set commitment); otherwise preserve order
 *   (sequence commitment). Defaults to `false`.
 * @returns The lowercase hex Merkle root.
 */
export function merkleRoot(leaves: readonly string[], opts: { sort?: boolean } = {}): string {
  if (leaves.length === 0) return EMPTY_ROOT;
  const ordered = opts.sort ? [...leaves].sort() : [...leaves];
  let level = ordered.map(hashLeaf);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      // Pair adjacent nodes; promote a lone trailing node unchanged (do not duplicate it).
      next.push(i + 1 < level.length ? hashNode(level[i]!, level[i + 1]!) : level[i]!);
    }
    level = next;
  }
  return level[0]!;
}
