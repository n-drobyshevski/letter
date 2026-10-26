import { Skia, type SkPath } from '@shopify/react-native-skia';
import { getStroke } from 'perfect-freehand';

/** A pen stroke as captured: x, y, pressure (0..1), time (ms since stroke start). */
export type StrokePoint = [number, number, number, number];
export type Stroke = StrokePoint[];

/**
 * Fingers have no pressure, so it is derived from speed: a slow hand presses,
 * a fast flick barely touches. Real stylus pressure (Pencil, pen tablet) wins when present.
 */
export function pressureFromSpeed(prev: StrokePoint | undefined, x: number, y: number, t: number, stylus?: number) {
  if (stylus !== undefined && stylus > 0) return stylus;
  if (!prev) return 0.55;
  const dt = Math.max(1, t - prev[3]);
  const v = Math.hypot(x - prev[0], y - prev[1]) / dt; // px per ms
  const target = Math.min(0.9, Math.max(0.25, 0.85 - v * 0.35));
  return prev[2] + (target - prev[2]) * 0.3;
}

/** Outline of a fountain-pen-ish stroke as a filled Skia path. */
export function strokeToPath(stroke: Stroke, size: number): SkPath {
  const outline = getStroke(
    stroke.map(([x, y, p]) => [x, y, p]),
    { size, thinning: 0.62, smoothing: 0.55, streamline: 0.45, simulatePressure: false, last: true },
  );
  const path = Skia.PathBuilder.Make();
  if (outline.length < 2) return path.detach();
  // Quadratic midpoints give a smooth outline instead of a polygon.
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1];
    const [x1, y1] = outline[i];
    path.quadTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.close();
  return path.detach();
}
