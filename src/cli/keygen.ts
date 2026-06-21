/**
 * Signing-seed generation for the `sentinel` CLI.
 *
 * Produces the base64-encoded random seed that operators paste into
 * `SENTINEL_SIGNING_SEED` to give a self-hosted gate a stable signer identity
 * across restarts. Backs the `sentinel keygen` command and the wizard's
 * "generate a seed now?" step.
 */

import { randomBytes } from 'node:crypto';

/**
 * Generate a fresh base64-encoded Ed25519 seed for `SENTINEL_SIGNING_SEED`.
 *
 * The 32-byte random seed gives the sidecar's signer a stable identity, so
 * provenance records keep verifying across process restarts instead of getting
 * a new ephemeral key each boot.
 *
 * @returns A base64-encoded 32-byte seed suitable for `SENTINEL_SIGNING_SEED`.
 */
export function generateSigningSeed(): string {
  return randomBytes(32).toString('base64');
}
