import { test, expect, describe } from 'vitest';
import { preflight, PreflightSeverity } from './preflight.js';
import type { SentinelConfig } from '../config.js';

const base: SentinelConfig = { sidecarPort: 4000, secondOpinionProvider: 'mock' };

describe('preflight', () => {
  test('mock provider needs no key', () => {
    expect(preflight(base)).toEqual([]);
  });

  test('anthropic without a key warns about ANTHROPIC_API_KEY', () => {
    const issues = preflight({ ...base, secondOpinionProvider: 'anthropic' });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe(PreflightSeverity.Warning);
    expect(issues[0]?.message).toContain('ANTHROPIC_API_KEY');
    expect(issues[0]?.hint).toMatch(/console\.anthropic\.com/);
  });

  test('anthropic with a key is clean', () => {
    expect(preflight({ ...base, secondOpinionProvider: 'anthropic', anthropicApiKey: 'sk-test' })).toEqual([]);
  });

  test('openai without a key warns about OPENAI_API_KEY', () => {
    const issues = preflight({ ...base, secondOpinionProvider: 'openai' });
    expect(issues[0]?.message).toContain('OPENAI_API_KEY');
  });

  test('openai with a key is clean', () => {
    expect(preflight({ ...base, secondOpinionProvider: 'openai', openaiApiKey: 'sk-test' })).toEqual([]);
  });
});
