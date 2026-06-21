/**
 * Terminal ANSI color helpers shared by the CLI banner and the sidecar's startup logs.
 *
 * Two opt-out rules and a contrast rule:
 *  - color is emitted only when stdout is a terminal (or `FORCE_COLOR` is set) and `NO_COLOR` is unset;
 *  - 24-bit *truecolor* (the brand gradient/accent) is used only when the terminal advertises it via
 *    `COLORTERM`, since terminals without it (e.g. Apple Terminal) downsample 24-bit codes to garish
 *    ANSI approximations — the accent falls back to a 16-color magenta instead;
 *  - text and semantic log colors use **16-color ANSI** (`bold` is weight-only, `success`/`warn`/
 *    `danger` are the theme's green/yellow/red), so they stay readable on light *and* dark
 *    backgrounds instead of assuming a dark theme with bright-white text.
 */

import { stdout } from 'node:process';

/** CSI introducer. */
export const ESC = '\x1b[';
/** SGR reset. */
export const RESET = `${ESC}0m`;
/** The Montana Labs brand violet (≈ #7C6AFF) as a 24-bit SGR parameter. */
export const VIOLET = '38;2;124;106;255';

/**
 * Whether terminal color should be emitted.
 *
 * @returns `true` when stdout is a TTY (or `FORCE_COLOR` is set) and `NO_COLOR` is unset.
 */
export function colorEnabled(): boolean {
  if (process.env['NO_COLOR']) return false;
  return Boolean(stdout.isTTY) || Boolean(process.env['FORCE_COLOR']);
}

/**
 * Whether 24-bit truecolor (the brand gradient) should be used.
 *
 * @returns `true` when color is on and `COLORTERM` advertises `truecolor`/`24bit`.
 */
export function truecolorEnabled(): boolean {
  if (!colorEnabled()) return false;
  const ct = process.env['COLORTERM'];
  return ct === 'truecolor' || ct === '24bit';
}

function paint(codes: string): (s: string, color?: boolean) => string {
  return (s, color = colorEnabled()) => (color ? `${ESC}${codes}m${s}${RESET}` : s);
}

/** Brand accent: truecolor violet where supported, else 16-color magenta. */
export function accent(s: string, color = colorEnabled()): string {
  if (!color) return s;
  return `${ESC}${truecolorEnabled() ? VIOLET : '35'}m${s}${RESET}`;
}
/** Bold, in the terminal's default foreground — readable on light and dark backgrounds. */
export const bold = paint('1');
/** Dimmed secondary text. */
export const dim = paint('2');
/** Success — the theme's green (16-color, adapts to the background). */
export const success = paint('32');
/** Warning — the theme's yellow/amber (16-color). */
export const warn = paint('33');
/** Error — the theme's red (16-color). */
export const danger = paint('31');
