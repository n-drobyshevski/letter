import { mulberry32, subSeed, wobble } from '../lib/random';
import type { PaperSpec, Rgb } from '../theme/stationery';

/**
 * Sheet geometry with no Skia in it (so node tests can load it): where the
 * creases are, the paper shader's uniforms, and the writing area on each side.
 */

/** The single desk light: from the top-left, slightly in front. */
export const LIGHT_DIR = { x: -0.45, y: -0.75 } as const;

export type SheetGeometry = { width: number; height: number };

/** LINER_SKSL's uniforms for a liner (`LINERS[kind]`), in declaration order (`px`: device pixels per local unit across its lines). */
export const linerUniforms = (l: { base: Rgb; pattern: Rgb; scale: number }, seed: number, shade: number, px: number) => [
  seed % 997,
  ...l.base,
  ...l.pattern,
  l.scale,
  shade,
  px,
];

/** Which face of a sheet: the front (recto) or the back (verso). */
export type Side = 'recto' | 'verso';

/** The two fold lines of a tri-fold: near the thirds, never exactly on them. */
export function creaseOffsets(seed: number): [number, number] {
  const rand = mulberry32(subSeed(seed, 'fold'));
  return [wobble(rand, 5), wobble(rand, 5)];
}

/**
 * Uniforms for PAPER_SKSL, in declaration order. `seed` seeds the pulp,
 * `foldSeed` the creases (one for the whole stack, so every sheet's creases line up).
 * The verso is the same pulp seen from behind: the shader mirrors it.
 */
export function paperUniforms(
  paper: PaperSpec,
  sheet: SheetGeometry,
  seed: number,
  crease: number,
  fold: 'tri' | 'half' | 'quarter' = 'tri',
  side: Side = 'recto',
  foldSeed = seed,
): number[] {
  const [c1, c2] = creaseOffsets(foldSeed);
  // A notebook's margin is on the outer edge (right on the recto); Seyès is ruled two pitches from the left.
  const marginX = paper.ruling === 'grid' ? sheet.width - paper.cell * 2.6 : paper.ruling === 'seyes' ? paper.cell * 2 : 0;
  return [
    sheet.width, sheet.height,
    seed % 9973,
    ...paper.base,
    paper.cell,
    marginX,
    ...paper.gridColor,
    ...paper.marginColor,
    crease,
    LIGHT_DIR.x, LIGHT_DIR.y,
    c1, c2,
    fold === 'tri' ? 0 : fold === 'half' ? 1 : 2,
    paper.ruling === 'seyes' ? 1 : 0,
    ...(paper.heavyColor ?? paper.gridColor),
    paper.marginSide === 'left' ? 1 : 0,
    paper.cockle ?? 0,
    side === 'verso' ? 1 : 0,
  ];
}

/**
 * Writing area for a sheet: inside the margins, baselines on the grid.
 * A notebook leaf has its margin on the outer edge: right on the recto, so on
 * the verso (turned like a book page) it is on the left and the area mirrors.
 * A Seyès face is printed with its margin on the left of both faces: the area is the same.
 */
export function writingArea(paper: PaperSpec, sheet: SheetGeometry, fontSize: number, side: Side = 'recto') {
  if (paper.ruling === 'seyes') {
    // Baselines on the heavy lines, one pitch apart (a notebook's two cells), starting two pitches down.
    const u = paper.cell;
    const left = u * 2 + u * 0.35;
    const right = sheet.width - u * 0.6;
    const top = u * 2;
    const lineHeight = u;
    const maxLines = Math.floor((sheet.height - top - u) / lineHeight) + 1;
    return { left, top, maxWidth: right - left, lineHeight, maxLines };
  }
  if (paper.ruling === 'grid') {
    // Notebook habit: start two cells in, write on every second line of cells,
    // baselines sitting exactly on a printed grid line.
    const cell = paper.cell;
    const left = side === 'verso' ? cell * 3.2 : cell * 2;
    const right = side === 'verso' ? sheet.width - cell * 2 : sheet.width - cell * 3.2;
    const lineHeight = cell * 2;
    const top = cell * 4;
    const maxLines = Math.floor((sheet.height - top - cell * 2) / lineHeight) + 1;
    return { left, top, maxWidth: right - left, lineHeight, maxLines };
  }
  const left = sheet.width * 0.1;
  const lineHeight = fontSize * 1.75;
  const top = sheet.height * 0.09 + lineHeight * 0.6;
  const maxLines = Math.floor((sheet.height * 0.93 - top) / lineHeight) + 1;
  return { left, top, maxWidth: sheet.width * 0.8, lineHeight, maxLines };
}
