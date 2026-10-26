/**
 * Seeded randomness. Every "imperfection" in a letter (word jitter, fold offset,
 * seal shape, postmark rotation) is derived from the letter's seed so the sender
 * and the recipient see exactly the same sheet.
 */

/** mulberry32: tiny, fast, good enough for visual noise. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash, used to derive sub-seeds ("fold", "seal", ...) from one letter seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function subSeed(seed: number, purpose: string): number {
  return (hashString(purpose) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0;
}

/** Uniform in [min, max). */
export function range(rand: () => number, min: number, max: number): number {
  return min + (max - min) * rand();
}

/** Roughly normal (sum of 3 uniforms), centred on 0, mostly within ±spread. */
export function wobble(rand: () => number, spread: number): number {
  return ((rand() + rand() + rand()) / 3 - 0.5) * 2 * spread;
}
