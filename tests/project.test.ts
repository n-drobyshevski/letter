import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geoConicConformal } from 'd3-geo';

import { project } from '../src/letter/tracking/project';

const map = JSON.parse(readFileSync(new URL('../assets/map/europe.json', import.meta.url), 'utf8'));

test('runtime projection matches d3 (and the baked map) to within half a pixel', () => {
  const d3 = geoConicConformal()
    .parallels([47, 56])
    .rotate([map.projection.rotate, 0])
    .scale(map.projection.k);
  // Same scale; translate recovered from one point, then checked everywhere.
  const [x0, y0] = project(map.projection, 20, 50);
  const [dx, dy] = d3([20, 50])!;
  d3.translate([d3.translate()[0] + x0 - dx, d3.translate()[1] + y0 - dy]);
  for (const [lon, lat] of [[3.063, 50.637], [2.56, 49.005], [13.4, 52.52], [23.6, 52.13], [27.548, 53.889], [-3, 44], [33, 58.5]]) {
    const [ax, ay] = project(map.projection, lon, lat);
    const [bx, by] = d3([lon, lat])!;
    assert.ok(Math.hypot(ax - bx, ay - by) < 0.5, `${lon},${lat}: ${ax},${ay} vs ${bx},${by}`);
  }
});

test('Lille and Minsk both land inside the map frame', () => {
  for (const [lon, lat] of [[3.063, 50.637], [27.548, 53.889]]) {
    const [x, y] = project(map.projection, lon, lat);
    assert.ok(x > 40 && x < map.width - 40 && y > 40 && y < map.height - 40, `${x},${y}`);
  }
  assert.ok(JSON.stringify(map).length < 60 * 1024, 'map data within the 60 KB budget');
});
