/**
 * Montana Labs / Sentinel CLI hero banner.
 *
 * Renders a "Welcome to Sentinel" box above a large, bold block-letter `SENTINEL` wordmark with a
 * horizontal Montana Labs gradient (indigo → violet → fuchsia) and a drop shadow — shown by
 * `sentinel init` and `sentinel start`. The glyphs use two-cell-wide strokes so vertical and
 * horizontal limbs read at the same visual weight despite the tall aspect ratio of terminal cells.
 * Color is opt-out via {@link colorEnabled}; with color off it degrades to plain block art.
 */

import { ESC, RESET, colorEnabled, truecolorEnabled, accent, bold, dim } from '../term/colors.js';

// Re-export the palette so CLI callers import their accents from one place.
export { accent, dim, bold, colorEnabled } from '../term/colors.js';

/** Gradient endpoints: indigo #6366F1 → fuchsia #D946EF (passing through the brand violet). */
const GRAD_START = [99, 102, 241] as const;
const GRAD_END = [217, 70, 239] as const;
/** Drop-shadow color: a dark, desaturated indigo. */
const SHADOW = `${ESC}38;2;58;54;94m`;

const HEIGHT = 5;

/** Bold 5-row block glyphs (two-cell strokes) for the letters in SENTINEL. */
const FONT: Record<string, readonly string[]> = {
  S: ['██████', '██    ', '██████', '    ██', '██████'],
  E: ['██████', '██    ', '█████ ', '██    ', '██████'],
  N: ['██   ██', '███  ██', '██ █ ██', '██  ███', '██   ██'],
  T: ['██████', '  ██  ', '  ██  ', '  ██  ', '  ██  '],
  I: ['██████', '  ██  ', '  ██  ', '  ██  ', '██████'],
  L: ['██    ', '██    ', '██    ', '██    ', '██████'],
  ' ': ['    ', '    ', '    ', '    ', '    '],
};

/** Assemble `text` into {@link HEIGHT} rows of block art (one space between glyphs). */
function blockArt(text: string): string[] {
  const rows: string[] = Array.from({ length: HEIGHT }, () => '');
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT[' ']!;
    for (let r = 0; r < HEIGHT; r++) rows[r] = `${rows[r] ?? ''}${glyph[r] ?? ''} `;
  }
  return rows;
}

/** Linear-interpolate one RGB channel. */
function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Truecolor SGR for gradient position `t` in `[0, 1]`. */
function gradientAt(t: number): string {
  const r = lerp(GRAD_START[0], GRAD_END[0], t);
  const g = lerp(GRAD_START[1], GRAD_END[1], t);
  const b = lerp(GRAD_START[2], GRAD_END[2], t);
  return `${ESC}38;2;${r};${g};${b}m`;
}

/**
 * Composite the block art with a drop shadow offset down-right by one cell.
 *
 * Each cell is the gradient glyph if filled; otherwise the shadow if the up-left cell is filled;
 * otherwise blank. Glyph cells win over shadow, so the shadow shows only where the letters don't.
 */
function shadowArt(artRows: readonly string[], color: boolean, truecolor: boolean): string {
  const w = Math.max(...artRows.map((r) => r.length));
  const filled = (r: number, c: number): boolean => (artRows[r]?.[c] ?? ' ') === '█';
  // Truecolor terminals get the gradient + drop shadow; others get bold default-foreground letters
  // (dark on light themes, light on dark themes) — never a downsampled 24-bit mess.
  const glyph = (c: number): string => {
    if (truecolor) return `${gradientAt(w <= 1 ? 0 : c / (w - 1))}█${RESET}`;
    return color ? `${ESC}1m█${RESET}` : '█';
  };
  const lines: string[] = [];
  for (let r = 0; r <= HEIGHT; r++) {
    let line = '';
    for (let c = 0; c <= w; c++) {
      if (filled(r, c)) {
        line += glyph(c);
      } else if (truecolor && r > 0 && c > 0 && filled(r - 1, c - 1)) {
        line += `${SHADOW}█${RESET}`; // drop shadow only in truecolor
      } else {
        line += ' ';
      }
    }
    lines.push(`  ${line}`);
  }
  return lines.join('\n');
}

/** A single-line rounded box, violet border, indented two spaces. */
function welcomeBox(visible: string, styled: string, color: boolean): string {
  const bar = accent('│', color);
  const top = accent(`╭${'─'.repeat(visible.length + 2)}╮`, color);
  const bottom = accent(`╰${'─'.repeat(visible.length + 2)}╯`, color);
  return [top, `${bar} ${styled} ${bar}`, bottom].map((l) => `  ${l}`).join('\n');
}

/**
 * Build the Sentinel hero: a welcome box over the gradient, drop-shadowed block wordmark.
 *
 * @param opts - `color` forces colorization (defaults to {@link colorEnabled}); `version` is shown
 *   in the welcome box (e.g. `v0.1.0`).
 * @returns The multi-line banner string (already styled or plain).
 */
export function heroBanner(opts: { color?: boolean; version?: string; truecolor?: boolean } = {}): string {
  const color = opts.color ?? colorEnabled();
  const truecolor = opts.truecolor ?? (color && truecolorEnabled());
  const ver = opts.version ? ` ${opts.version}` : '';
  const welcomeVisible = `✦  Welcome to Sentinel${ver} · by Montana Labs`;
  const welcomeStyled = `${accent('✦', color)}  Welcome to ${bold('Sentinel', color)}${accent(ver, color)}${dim(' · by Montana Labs', color)}`;
  return [
    welcomeBox(welcomeVisible, welcomeStyled, color),
    '',
    shadowArt(blockArt('SENTINEL'), color, truecolor),
    '',
    `  ${dim('the independent action-gate for AI agents', color)}`,
  ].join('\n');
}
