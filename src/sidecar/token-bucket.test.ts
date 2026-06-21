import { test, expect, describe } from 'vitest';
import { TokenBucket } from './token-bucket.js';

describe('TokenBucket', () => {
  test('starts full and allows up to capacity, then denies', () => {
    let t = 0;
    const b = new TokenBucket({ capacity: 3, refillPerSec: 0, now: () => t });
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(false);
  });

  test('refills over time at refillPerSec', () => {
    let t = 0;
    const b = new TokenBucket({ capacity: 2, refillPerSec: 2, now: () => t });
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(false);
    t = 1000; // +1s -> +2 tokens
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(false);
  });

  test('never refills beyond capacity', () => {
    let t = 0;
    const b = new TokenBucket({ capacity: 2, refillPerSec: 100, now: () => t });
    t = 10_000; // huge elapsed
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(false);
  });
});
