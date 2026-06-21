/**
 * Non-blocking counting semaphore used by the sidecar to bound the number of
 * concurrent in-flight `/v1/*` requests. Acquisition is best-effort: callers that
 * cannot acquire are shed immediately (HTTP 503 upstream) rather than queued.
 */

/** A non-blocking counting semaphore for limiting concurrent in-flight work. */
export class Semaphore {
  private count = 0;
  constructor(private readonly max: number) {}

  /** Number of permits currently held (in-flight work). */
  get inFlight(): number {
    return this.count;
  }

  /**
   * Attempt to acquire one permit without blocking.
   *
   * @returns `true` if a permit was acquired, `false` if all permits are in use.
   */
  tryAcquire(): boolean {
    if (this.count >= this.max) return false;
    this.count += 1;
    return true;
  }

  /** Release one permit. Never drops the in-flight count below zero. */
  release(): void {
    if (this.count > 0) this.count -= 1;
  }
}
