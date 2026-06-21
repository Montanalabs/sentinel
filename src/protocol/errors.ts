/**
 * Typed errors for the adjudication protocol.
 *
 * Every protocol failure is a typed error (not a bare `Error` or boolean) so callers can branch on
 * the precise cause and so the HTTP/SDK layers can map them to stable codes. The protocol fails
 * CLOSED: any unrecognized or malformed state is treated as a denial, never an allow.
 */

/** Machine-readable codes for a protocol failure (stable across the API/SDK boundary). */
export enum ProtocolErrorCode {
  /** A proposed action could not be deterministically canonicalized (ambiguous/unsupported value). */
  NonCanonicalAction = 'NON_CANONICAL_ACTION',
  /** A receipt's Ed25519 signature did not verify. */
  InvalidSignature = 'INVALID_SIGNATURE',
  /** The receipt is past its `expiresAt`. */
  ExpiredReceipt = 'EXPIRED_RECEIPT',
  /** The current time precedes the receipt's validity window. */
  NotYetValid = 'NOT_YET_VALID',
  /** The executed action's digest does not match the authorized one. */
  ActionMismatch = 'ACTION_MISMATCH',
  /** The execution context digest does not match the authorized one. */
  ContextMismatch = 'CONTEXT_MISMATCH',
  /** The receipt's nonce has already been consumed (replay). */
  ReplayDetected = 'REPLAY_DETECTED',
  /** The receipt was signed by a key id outside the trusted set. */
  UntrustedIssuer = 'UNTRUSTED_ISSUER',
  /** The receipt has been explicitly revoked. */
  RevokedReceipt = 'REVOKED_RECEIPT',
  /** The receipt's final verdict is not ALLOW (only ALLOW is executable). */
  InvalidVerdict = 'INVALID_VERDICT',
  /** The policy digest/version on the receipt does not match the executing policy. */
  PolicyMismatch = 'POLICY_MISMATCH',
  /** Human approval is required for this action but absent from the receipt. */
  MissingHumanApproval = 'MISSING_HUMAN_APPROVAL',
  /** The receipt's protocol version is not supported by this validator. */
  UnsupportedProtocolVersion = 'UNSUPPORTED_PROTOCOL_VERSION',
  /** A receipt field was structurally malformed. */
  MalformedReceipt = 'MALFORMED_RECEIPT',
}

/**
 * An adjudication-protocol failure carrying a stable {@link ProtocolErrorCode}.
 *
 * Thrown by canonicalization, receipt validation, and nonce consumption. The `code` is the contract
 * surface; the message is human context only.
 */
export class ProtocolError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}
