/**
 * Deterministic commitment to the exact policy used for an adjudication.
 *
 * An authorization receipt must bind not just a *version string* (which is mutable and can be
 * silently swapped) but a digest of the policy's actual decision surface: its version, the
 * configuration of every pack/verifier (secrets excluded), and the versions of the deterministic
 * checkers that ran. A validator at execution time recomputes this and rejects the receipt if the
 * policy has changed (`POLICY_MISMATCH`), preventing policy substitution between approval and use.
 *
 * Note (see the protocol plan §3-B): policy packs contain *code*, which cannot be content-hashed;
 * this commits to the policy **definition data + config + explicit checker versions**, so the code
 * path is pinned by version. That boundary is intentional and documented.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical.js';

/**
 * The serializable surface of the policy that decided an action.
 *
 * @remarks `config` must already have secrets stripped (API keys, signing seeds). `checkerVersions`
 *   pins each deterministic checker by an explicit version constant.
 */
export interface PolicyManifest {
  /** Human-facing policy version, e.g. `fintech.payments@1`. */
  readonly policyVersion: string;
  /** Map of checker name → version, e.g. `{ schema: '1', reconcile: '2' }`. */
  readonly checkerVersions: Readonly<Record<string, string>>;
  /** Pack + verifier configuration that affects decisions (NO secrets). */
  readonly config: Readonly<Record<string, unknown>>;
}

/** The commitment a receipt carries: a stable digest plus the human version it pins. */
export interface PolicyCommitment {
  readonly policyVersion: string;
  readonly policyBundleDigest: string;
}

/**
 * Deterministic SHA-256 digest of a {@link PolicyManifest}.
 *
 * Order-independent (canonicalized) so equal policy state always digests identically and any change
 * to version, checker versions, or config changes it.
 */
export function policyBundleDigest(manifest: PolicyManifest): string {
  return createHash('sha256')
    .update(
      canonicalize({
        policyVersion: manifest.policyVersion,
        checkerVersions: manifest.checkerVersions,
        config: manifest.config,
      }),
    )
    .digest('hex');
}

/**
 * Build a {@link PolicyCommitment} from a manifest.
 *
 * @param manifest - The policy decision surface; see {@link PolicyManifest}.
 * @returns The version + bundle digest a receipt binds to.
 */
export function commitPolicy(manifest: PolicyManifest): PolicyCommitment {
  return { policyVersion: manifest.policyVersion, policyBundleDigest: policyBundleDigest(manifest) };
}
