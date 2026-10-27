import { useLocalSearchParams } from 'expo-router';

/**
 * Reads lab/QA overrides from the URL (?seed=7&t=0.5&paper=cotton&open=seal&sheets=2&face=1&turn=0.5) so screenshots are reproducible.
 * The seal: sx, sy (puddle) and kx, ky (die) as fractions of the back, rot (radians), depth (0.35..1),
 * die (a SealDie), hold (a SealPreset: tip, left, flap, body); seal.ts's sealFromParams builds the placement.
 * The desk: drawer (paper, pens, envelopes) frozen open at dt (0..1), item (a DeskItem id) shown lifted,
 * kb=1 (keyboard up: the band hidden), rm=1 (Reduce Motion), debug=1 (render counters).
 */
export function useLabParams() {
  const p = useLocalSearchParams<{ seed?: string; t?: string; paper?: string; ink?: string; font?: string; open?: string; wax?: string; country?: string; waiting?: string; tier?: string; viewer?: string; day?: string; fold?: string; step?: string; sheets?: string; face?: string; turn?: string; tilt?: string; sx?: string; sy?: string; kx?: string; ky?: string; rot?: string; depth?: string; die?: string; hold?: string; drawer?: string; dt?: string; item?: string; kb?: string; rm?: string; debug?: string }>();
  const num = (v?: string) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
  return { seed: num(p.seed), t: num(p.t), paper: p.paper, ink: p.ink, font: p.font, open: p.open, wax: p.wax, country: p.country, waiting: num(p.waiting), tier: p.tier, viewer: p.viewer, day: num(p.day), fold: p.fold, step: p.step, sheets: num(p.sheets), face: num(p.face), turn: num(p.turn), tilt: num(p.tilt), sx: num(p.sx), sy: num(p.sy), kx: num(p.kx), ky: num(p.ky), rot: num(p.rot), depth: num(p.depth), die: p.die, hold: p.hold, drawer: p.drawer, dt: num(p.dt), item: p.item, kb: num(p.kb), rm: num(p.rm), debug: num(p.debug) };
}
