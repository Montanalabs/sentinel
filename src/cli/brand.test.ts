import { test, expect, describe } from 'vitest';
import { heroBanner, accent, dim, bold } from './brand.js';

describe('brand', () => {
  test('plain banner has the welcome box, version, block wordmark, and brand content', () => {
    const b = heroBanner({ color: false, version: 'v0.1.0' });
    expect(b).toContain('╭'); // welcome box
    expect(b).toContain('Welcome to Sentinel v0.1.0'); // version shown
    expect(b).toContain('by Montana Labs');
    expect(b).toContain('█'); // block-letter wordmark
    expect(b).toContain('the independent action-gate for AI agents');
    expect(b).not.toContain('\x1b'); // no ANSI when color is off
  });

  test('truecolor banner emits the gradient and the drop-shadow color', () => {
    const b = heroBanner({ color: true, truecolor: true });
    expect(b).toContain(`${'\x1b'}[38;2;`); // truecolor stops (gradient + shadow)
    expect(b).toContain('\x1b[38;2;58;54;94m'); // drop-shadow color
    expect(b).toContain('\x1b[0m'); // reset
  });

  test('non-truecolor banner uses bold default-foreground letters, no 24-bit codes', () => {
    const b = heroBanner({ color: true, truecolor: false });
    expect(b).not.toContain('38;2;'); // never a downsampled 24-bit gradient
    expect(b).toContain('\x1b[1m█'); // bold default-fg block (readable on light + dark)
  });

  test('the block-art rows are all the same display width', () => {
    const artRows = heroBanner({ color: false })
      .split('\n')
      .filter((l) => l.includes('█'));
    const widths = new Set(artRows.map((l) => l.length));
    expect(widths.size).toBe(1);
  });

  test('style helpers are no-ops when color is disabled', () => {
    expect(accent('x', false)).toBe('x');
    expect(dim('x', false)).toBe('x');
    expect(bold('x', false)).toBe('x');
  });
});
