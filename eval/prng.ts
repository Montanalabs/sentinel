/**
 * Tiny deterministic PRNG (mulberry32) for the evaluation harness.
 *
 * The eval must be reproducible — the same seed produces the same scenario corpus and therefore the
 * same results table in the paper and in CI. `Math.random()` is non-deterministic, so the generator
 * uses this seeded function instead. Not cryptographic; only ever used to lay out test scenarios.
 */

/** A deterministic `() => number` in `[0, 1)` seeded by `seed`. */
export function makePrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic boolean true with probability `p`. */
export function chance(rng: () => number, p: number): boolean {
  return rng() < p;
}

/** Deterministically pick one element of `items` (non-empty). */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] ?? items[0]!;
}
