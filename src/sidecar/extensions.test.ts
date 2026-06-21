import { test, expect, describe } from 'vitest';
import { resolveConfigPath } from './extensions.js';

const exists = (set: string[]) => (p: string) => set.includes(p);

describe('resolveConfigPath', () => {
  test('uses SENTINEL_CONFIG when it points at an existing file', () => {
    expect(resolveConfigPath('/app', { SENTINEL_CONFIG: '/etc/sentinel.mjs' } as NodeJS.ProcessEnv, exists(['/etc/sentinel.mjs']))).toBe('/etc/sentinel.mjs');
  });

  test('SENTINEL_CONFIG pointing at a missing file resolves to null', () => {
    expect(resolveConfigPath('/app', { SENTINEL_CONFIG: '/etc/nope.mjs' } as NodeJS.ProcessEnv, exists([]))).toBeNull();
  });

  test('falls back to sentinel.config.mjs in cwd', () => {
    expect(resolveConfigPath('/app', {} as NodeJS.ProcessEnv, exists(['/app/sentinel.config.mjs']))).toBe('/app/sentinel.config.mjs');
  });

  test('then sentinel.config.js', () => {
    expect(resolveConfigPath('/app', {} as NodeJS.ProcessEnv, exists(['/app/sentinel.config.js']))).toBe('/app/sentinel.config.js');
  });

  test('returns null when nothing is present', () => {
    expect(resolveConfigPath('/app', {} as NodeJS.ProcessEnv, exists([]))).toBeNull();
  });
});
