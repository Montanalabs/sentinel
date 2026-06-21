import { test, expect, describe } from 'vitest';
import { accent, dim, bold, success, warn, danger } from './colors.js';

describe('colors', () => {
  test('helpers are no-ops when color is disabled', () => {
    for (const f of [accent, dim, bold, success, warn, danger]) {
      expect(f('x', false)).toBe('x');
    }
  });

  test('helpers wrap in an SGR sequence and reset when color is enabled', () => {
    for (const f of [accent, dim, bold, success, warn, danger]) {
      const out = f('x', true);
      expect(out.startsWith('\x1b[')).toBe(true);
      expect(out.endsWith('\x1b[0m')).toBe(true);
      expect(out).toContain('x');
    }
  });
});
