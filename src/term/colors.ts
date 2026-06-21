/**
 * Terminal ANSI color helpers shared by the CLI banner and the sidecar's startup logs.
 *
 * One palette, one opt-out rule: color is emitted only when stdout is a terminal (or `FORCE_COLOR`
 * is set) and `NO_COLOR` is unset, and every helper degrades to the plain string otherwise — so
 * piping to a file or a non-TTY never leaks escape codes. Truecolor (24-bit) is used for the brand
 * hues, which every modern terminal supports.
 */

import { stdout } from 'node:process';

/** CSI introducer. */
export const ESC = '\x1b[';
/** SGR reset. */
export const RESET = `${ESC}0m`;
/** The Montana Labs brand violet (≈ #7C6AFF) as a truecolor SGR parameter. */
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

function style(codes: string): (s: string, color?: boolean) => string {
  return (s, color = colorEnabled()) => (color ? `${ESC}${codes}m${s}${RESET}` : s);
}

/** Brand accent (violet). */
export const accent = style(VIOLET);
/** Bright/bold white (wordmark weight). */
export const bold = style('1;97');
/** Dimmed secondary text. */
export const dim = style('2');
/** Success/healthy (emerald, ≈ #34D399). */
export const success = style('38;2;52;211;153');
/** Warning (amber, ≈ #F5C842). */
export const warn = style('38;2;245;200;66');
/** Error (red, ≈ #F87171). */
export const danger = style('38;2;248;113;113');
