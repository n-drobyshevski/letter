#!/usr/bin/env node
/**
 * Builds the tracking map: Natural Earth 1:50m (public domain, via world-atlas)
 * projected to a Lambert conformal conic over Western/Eastern Europe, clipped,
 * and written as SVG path strings for Skia (assets/map/europe.json).
 *
 *   node scripts/build-map.mjs
 *
 * The runtime re-projects lat/lon (route, cities) with the same formula
 * (src/letter/tracking/project.ts); tests/project.test.ts checks it against d3.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoConicConformal, geoPath, geoCentroid } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const require = createRequire(import.meta.url);
const world = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));

const W = 1200;
const H = 800;
const PARALLELS = [47, 56];
const ROTATE = -15;
// Lille → Minsk with room around it: lon −3…33, lat 44…58.5.
const bbox = {
  type: 'MultiPoint',
  coordinates: [
    [-3, 44], [33, 44], [-3, 58.5], [33, 58.5], [15, 44], [15, 58.5],
  ],
};

const projection = geoConicConformal().parallels(PARALLELS).rotate([ROTATE, 0]).fitExtent([[20, 20], [W - 20, H - 20]], bbox);
projection.clipExtent([[-20, -20], [W + 20, H + 20]]);
const path = geoPath(projection).digits(0); // whole pixels in a 1200-wide frame: ~0.3 px on a phone

// Runtime formula: x = a + k·xr, y = b − k·yr with the raw conic (see project.ts).
const rad = Math.PI / 180;
const tany = (y) => Math.tan((Math.PI / 2 + y) / 2);
const y0 = PARALLELS[0] * rad;
const y1 = PARALLELS[1] * rad;
const n = Math.log(Math.cos(y0) / Math.cos(y1)) / Math.log(tany(y1) / tany(y0));
const f = (Math.cos(y0) * Math.pow(tany(y0), n)) / n;
const raw = (lon, lat) => {
  const x = (lon + ROTATE) * rad;
  const r = f / Math.pow(tany(lat * rad), n);
  return [r * Math.sin(n * x), f - r * Math.cos(n * x)];
};
const k = projection.scale();
const [px, py] = projection([20, 50]);
const [rx, ry] = raw(20, 50);
const params = { n, f, k, a: px - k * rx, b: py + k * ry, rotate: ROTATE };
for (const [lon, lat] of [[3.06, 50.64], [27.55, 53.89], [-2, 45], [30, 57]]) {
  const [dx, dy] = projection([lon, lat]);
  const [qx, qy] = raw(lon, lat);
  const err = Math.hypot(params.a + k * qx - dx, params.b - k * qy - dy);
  if (err > 0.01) throw new Error(`runtime projection off by ${err} px at ${lon},${lat}`);
}

const countries = feature(world, world.objects.countries);
const land = feature(world, world.objects.land ?? world.objects.countries);
const byId = (id) => countries.features.find((c) => String(c.id).padStart(3, '0') === id);

// Country names as printed on old postal maps: in their own language.
const LABELS = {
  '250': ['FRANCE', null],
  '056': ['BELGIQUE', null],
  '528': ['NEDERLAND', null],
  '276': ['DEUTSCHLAND', null],
  '616': ['POLSKA', [18.6, 53.5]],
  '112': ['БЕЛАРУСЬ', [28.6, 52.35]],
  '440': ['LIETUVA', null],
  '428': ['LATVIJA', null],
  '804': ['УКРАЇНА', [29, 49.6]],
  '203': ['ČESKO', null],
  '040': ['ÖSTERREICH', [14.5, 47.6]],
  '756': ['SCHWEIZ', null],
  '208': ['DANMARK', [9.2, 56.1]],
  '826': ['UNITED KINGDOM', [-1.5, 52.5]],
  '703': ['SLOVENSKO', null],
  '348': ['MAGYARORSZÁG', [19.4, 47]],
  '643': ['РОССИЯ', [31.5, 56.5]],
  '233': ['EESTI', [25.5, 58.4]],
};
const labels = Object.entries(LABELS)
  .map(([id, [name, at]]) => {
    const c = byId(id);
    if (!c) return null;
    const [x, y] = projection(at ?? geoCentroid(c));
    if (x < 30 || x > W - 30 || y < 30 || y > H - 30) return null;
    return { id, name, x: Math.round(x), y: Math.round(y) };
  })
  .filter(Boolean);

// Seas (rough label points).
const seas = [
  { name: 'MER DU NORD', lonlat: [3.5, 55.4] },
  { name: 'MER BALTIQUE', lonlat: [18.6, 56.2] },
  { name: 'MANCHE', lonlat: [-1.6, 50.1] },
].map((s) => {
  const [x, y] = projection(s.lonlat);
  return { name: s.name, x: Math.round(x), y: Math.round(y) };
});

const out = {
  source: 'Natural Earth 1:50m via world-atlas 2.0.2 (public domain)',
  width: W,
  height: H,
  projection: params,
  land: path(land),
  borders: path(mesh(world, world.objects.countries, (a, b) => a !== b)),
  highlight: { fr: path(byId('250')), by: path(byId('112')) },
  labels,
  seas,
};
const json = JSON.stringify(out);
writeFileSync(new URL('../assets/map/europe.json', import.meta.url), json);
console.log(`assets/map/europe.json ${(json.length / 1024).toFixed(1)} KB, ${labels.length} labels`);
