/**
 * Lambert conformal conic, the same projection the map was baked with
 * (scripts/build-map.mjs). Hand-written so the app doesn't ship d3; the build
 * script and tests/project.test.ts check it against d3-geo.
 */
export type ProjectionParams = { n: number; f: number; k: number; a: number; b: number; rotate: number };

const RAD = Math.PI / 180;
const tany = (y: number) => Math.tan((Math.PI / 2 + y) / 2);

export function project(p: ProjectionParams, lon: number, lat: number): [number, number] {
  'worklet';
  const x = (lon + p.rotate) * RAD;
  const r = p.f / Math.pow(tany(lat * RAD), p.n);
  return [p.a + p.k * r * Math.sin(p.n * x), p.b - p.k * (p.f - r * Math.cos(p.n * x))];
}
