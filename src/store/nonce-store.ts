/**
 * Replay-protection store for authorization-receipt nonces.
 *
 * The protocol's single-use guarantee rests here: a receipt may be executed at most
 * `maxExecutions` times, and {@link NonceStore.consume} must record each execution **atomically**,
 * so that two concurrent executors of the same receipt cannot both succeed. Backends enforce this
 * with a database-level uniqueness/conditional-update (the same primitive the provenance chain uses
 * for monotonic appends), not an application-level read-then-write.
 */

/** Outcome of attempting to consume one execution slot of a receipt's nonce. */
export interface NonceConsumeResult {
  /** `true` if this call claimed a fresh execution slot; `false` means it was already exhausted (replay). */
  readonly consumed: boolean;
  /** The execution count after this attempt: the slot number claimed, or the cap when exhausted. */
  readonly executionCount: number;
}

/**
 * Atomic, replay-safe record of receipt-nonce consumption.
 *
 * One {@link NonceStore} instance corresponds to one logical replay-protection namespace and is
 * shared by every executor that validates against the same issuer.
 */
export interface NonceStore {
  /**
   * Atomically claim one execution slot for `nonce`, up to `maxExecutions` total.
   *
   * The first call for a nonce returns `{ consumed: true, executionCount: 1 }`. Subsequent calls
   * succeed while the count is below `maxExecutions`, then return `{ consumed: false }` — the replay
   * signal. Safe under concurrent callers: at most `maxExecutions` calls across all processes can
   * return `consumed: true` for a given nonce.
   *
   * @param receiptId - The receipt the nonce belongs to (stored for audit; does not affect atomicity).
   * @param nonce - The receipt's unique nonce.
   * @param maxExecutions - Maximum number of times the nonce may be consumed (≥ 1).
   * @returns Whether a slot was claimed and the resulting execution count.
   */
  consume(receiptId: string, nonce: string, maxExecutions: number): Promise<NonceConsumeResult>;

  /** Release any underlying resources (connections, file handles). */
  close(): Promise<void>;
}
