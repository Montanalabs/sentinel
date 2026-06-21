import { test, expect, describe } from 'vitest';
import { parseDotenv, loadConfig } from './config.js';

describe('parseDotenv', () => {
  test('parses KEY=VALUE lines', () => {
    expect(parseDotenv('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
  });
  test('ignores comments and blank lines', () => {
    expect(parseDotenv('# comment\n\nA=1\n   \n# x\nB=2')).toEqual({ A: '1', B: '2' });
  });
  test('trims whitespace around key and value', () => {
    expect(parseDotenv('  A = 1  ')).toEqual({ A: '1' });
  });
  test('preserves = inside values', () => {
    expect(parseDotenv('URL=postgres://u:p@h/db?x=1')).toEqual({ URL: 'postgres://u:p@h/db?x=1' });
  });
  test('strips surrounding quotes', () => {
    expect(parseDotenv('A="quoted value"\nB=\'single\'')).toEqual({ A: 'quoted value', B: 'single' });
  });
  test('strips an inline comment after an unquoted value', () => {
    expect(parseDotenv('A=anthropic   # the provider')).toEqual({ A: 'anthropic' });
  });
});

describe('loadConfig', () => {
  test('reads provider and slow-tier budget from env', () => {
    const c = loadConfig({ SENTINEL_SECOND_OPINION_PROVIDER: 'openai', SENTINEL_SLOW_BUDGET_MS: '8000' } as NodeJS.ProcessEnv);
    expect(c.secondOpinionProvider).toBe('openai');
    expect(c.slowBudgetMs).toBe(8000);
  });

  test('defaults: provider=mock, no slow budget override', () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.secondOpinionProvider).toBe('mock');
    expect(c.slowBudgetMs).toBeUndefined();
  });

  test('reads rate-limit and concurrency settings', () => {
    const c = loadConfig({
      SENTINEL_RATE_LIMIT_BURST: '100',
      SENTINEL_RATE_LIMIT_RPS: '50',
      SENTINEL_MAX_CONCURRENT: '32',
    } as unknown as NodeJS.ProcessEnv);
    expect(c.rateLimit).toEqual({ capacity: 100, refillPerSec: 50 });
    expect(c.maxConcurrent).toBe(32);
  });

  test('invalid numeric vars fall back to safe defaults rather than NaN/negative', () => {
    const c = loadConfig({
      SENTINEL_SIDECAR_PORT: '99999', // out of range -> default 4000
      SENTINEL_SLOW_BUDGET_MS: 'abc', // non-numeric -> unset
      SENTINEL_RATE_LIMIT_BURST: '0', // zero burst would brick with 429 -> dropped
      SENTINEL_RATE_LIMIT_RPS: '50',
      SENTINEL_MAX_BODY_BYTES: '-1', // negative -> unset (server default applies)
    } as unknown as NodeJS.ProcessEnv);
    expect(c.sidecarPort).toBe(4000);
    expect(c.slowBudgetMs).toBeUndefined();
    expect(c.rateLimit).toBeUndefined();
    expect(c.maxBodyBytes).toBeUndefined();
  });
});
