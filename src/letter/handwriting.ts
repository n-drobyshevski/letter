import { mulberry32, range, subSeed, wobble } from '../lib/random';

/**
 * Lays out typed text as if written by hand: per-word jitter on top of a
 * grid-aligned line layout. Words are shaped whole (never per glyph) so the
 * font's contextual alternates survive; all randomness comes from `seed`.
 */

export type HandwritingOptions = {
  seed: number;
  fontSize: number;
  /** Left edge of the writing area. */
  left: number;
  /** Baseline of the first line. */
  top: number;
  maxWidth: number;
  lineHeight: number;
  /** Max number of lines that fit the sheet; the rest is reported as overflow. */
  maxLines?: number;
};

export type PlacedWord = {
  text: string;
  x: number;
  y: number;
  /** Radians, applied around the word's left baseline point. */
  rotation: number;
  /** Ink load 0.8..1: fresh after a "dip", fading as the nib runs dry. */
  opacity: number;
  scale: number;
  line: number;
};

export type HandwritingLayout = {
  words: PlacedWord[];
  lines: number;
  /** Index in the source text where layout stopped because the sheet was full, or -1. */
  overflowAt: number;
};

export function layoutHandwriting(
  text: string,
  measure: (word: string) => number,
  opts: HandwritingOptions,
): HandwritingLayout {
  const rand = mulberry32(subSeed(opts.seed, 'handwriting'));
  const space = measure(' ') || opts.fontSize * 0.28;
  const maxLines = opts.maxLines ?? Infinity;
  const words: PlacedWord[] = [];

  let line = 0;
  let lineStart = true;
  let x = 0;
  let lineSlope = 0;
  let lineIndent = 0;
  let charsSinceDip = 0;
  let nextDip = Math.round(range(rand, 40, 80));
  let overflowAt = -1;

  const startLine = () => {
    // Hands drift: each line gets its own slight slope and a wobbly left margin.
    lineSlope = wobble(rand, 0.006);
    lineIndent = wobble(rand, 3);
    x = lineIndent;
    lineStart = true;
  };

  const paragraphs = text.split('\n');
  let cursor = 0;
  startLine();

  outer: for (let p = 0; p < paragraphs.length; p++) {
    let paragraphStart = true;
    if (p > 0) {
      cursor += 1; // the '\n'
      line++;
      if (line >= maxLines) {
        overflowAt = cursor;
        break;
      }
      startLine();
    }
    const tokens = paragraphs[p].split(/( +)/);
    for (const token of tokens) {
      const tokenStart = cursor;
      cursor += token.length;
      if (token.length === 0) continue;
      if (token.trim().length === 0) {
        // Leading spaces of a paragraph indent it; spaces at a wrapped line start are dropped.
        if (paragraphStart || !lineStart) x += space * token.length * range(rand, 0.85, 1.2);
        continue;
      }
      const scale = 1 + wobble(rand, 0.025);
      const width = measure(token) * scale;
      if (!lineStart && x + width > opts.maxWidth) {
        line++;
        if (line >= maxLines) {
          overflowAt = tokenStart;
          break outer;
        }
        startLine();
      }

      charsSinceDip += token.length;
      if (charsSinceDip >= nextDip) {
        charsSinceDip = 0;
        nextDip = Math.round(range(rand, 40, 80));
      }
      const inkLoad = 1 - 0.18 * (charsSinceDip / nextDip);

      const baseline = opts.top + line * opts.lineHeight;
      words.push({
        text: token,
        x: opts.left + x,
        y: baseline + x * lineSlope + wobble(rand, 1.4),
        rotation: wobble(rand, (1 * Math.PI) / 180) + lineSlope,
        opacity: Math.max(0.8, Math.min(1, inkLoad + wobble(rand, 0.03))),
        scale,
        line,
      });
      x += width;
      lineStart = false;
      paragraphStart = false;
    }
  }

  return { words, lines: line + 1, overflowAt };
}
