import { mulberry32, range, subSeed } from '../lib/random';

/**
 * A paper-knife slit along the envelope's top fold: not a ruler line (the blade
 * wanders and catches on fibres) but never a ragged tear either.
 * Returns [x0, y0, x1, y1, …] in envelope-local points, y measured from the top edge.
 */
export function slitEdge(width: number, seed: number, step = 3): number[] {
  const rand = mulberry32(subSeed(seed, 'slit'));
  const waves = Array.from({ length: 3 }, (_, i) => ({
    freq: range(rand, 0.6, 1.4) * (i + 1) * 0.02,
    phase: rand() * Math.PI * 2,
    amp: 0.35 / (i + 1),
  }));
  const pts: number[] = [];
  const n = Math.ceil(width / step);
  for (let i = 0; i <= n; i++) {
    const x = Math.min(i * step, width); // always end exactly at the far corner
    let y = 1.6;
    for (const w of waves) y += w.amp * Math.sin(x * w.freq + w.phase);
    y += (rand() - 0.5) * 0.25; // fibre-scale jitter
    pts.push(x, y);
  }
  return pts;
}

/** Where the blade catches: seeded stick-slip points (fractions of the width) for the fibre haptic. */
export function slitCatches(width: number, seed: number): number[] {
  const rand = mulberry32(subSeed(seed, 'catches'));
  const out: number[] = [];
  for (let x = range(rand, 18, 30); x < width; x += range(rand, 18, 30)) out.push(x / width);
  return out;
}
