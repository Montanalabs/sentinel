/**
 * Revocation list for authorization receipts.
 *
 * A receipt can be revoked before it expires (e.g. on detected compromise or a withdrawn approval).
 * The {@link ReceiptValidator} consults a {@link RevocationStore} and fails closed
 * (`REVOKED_RECEIPT`) for any revoked receipt id. The in-memory implementation suits single-node
 * deployments; durable backends can implement the same interface.
 */

/** A store of revoked receipt ids. */
export interface RevocationStore {
  /** Mark a receipt id as revoked. */
  revoke(receiptId: string): Promise<void>;
  /** Whether a receipt id has been revoked. */
  isRevoked(receiptId: string): Promise<boolean>;
}

/** In-memory revocation list (non-durable; for single-node use/tests). */
export class InMemoryRevocationStore implements RevocationStore {
  private readonly revoked = new Set<string>();

  async revoke(receiptId: string): Promise<void> {
    this.revoked.add(receiptId);
  }

  async isRevoked(receiptId: string): Promise<boolean> {
    return this.revoked.has(receiptId);
  }
}
