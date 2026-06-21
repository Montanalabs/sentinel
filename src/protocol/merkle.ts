/**
 * Binary Merkle root over a list of hex leaf digests.
 *
 * Shared by the evidence-set commitment (which sorts leaves to commit to a *set*) and the audit
 * checkpoints (which preserve leaf order to commit to an ordered *sequence*). An odd node is paired
 * with itself; an empty input yields the SHA-256 of empty.
 */

import { createHash } from 'node:crypto';

const EMPTY_ROOT = createHash('sha256').update('').digest('hex');

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
  let level = opts.sort ? [...leaves].sort() : [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = i + 1 < level.length ? level[i + 1]! : a; // duplicate last node when odd
      next.push(createHash('sha256').update(a + b).digest('hex'));
    }
    level = next;
  }
  return level[0]!;
}
