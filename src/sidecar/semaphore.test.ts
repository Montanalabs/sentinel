import { test, expect, describe } from 'vitest';
import { Semaphore } from './semaphore.js';

describe('Semaphore', () => {
  test('grants up to max, denies when saturated, frees on release', () => {
    const s = new Semaphore(2);
    expect(s.tryAcquire()).toBe(true);
    expect(s.tryAcquire()).toBe(true);
    expect(s.inFlight).toBe(2);
    expect(s.tryAcquire()).toBe(false);
    s.release();
    expect(s.inFlight).toBe(1);
    expect(s.tryAcquire()).toBe(true);
  });

  test('release never drops below zero', () => {
    const s = new Semaphore(1);
    s.release();
    s.release();
    expect(s.inFlight).toBe(0);
  });
});
