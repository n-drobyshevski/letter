import {
  BlurMask,
  BlurStyle,
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Path,
  Picture,
  Rect,
  Skia,
  Text as SkiaText,
  ClipOp,
  PaintStyle,
  type SkCanvas,
  type SkFont,
  type SkPath,
  type SkPicture,
  type SkTypeface,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import mapData from '../../assets/map/europe.json';
import { mulberry32, subSeed, wobble } from '../lib/random';
import { PAPERS, type PaperSpec } from '../theme/stationery';
import { paperUniforms } from './renderLetter';
import { PAPER_SKSL } from './shaders';
import { clock, mapSummary, shortDate, type Lang } from './tracking/copy';
import { estimatedRouteT, FR_BY_POLYLINE, routeFractions, routeLengthKm, type Itinerary } from './tracking/itinerary';
import { project, type ProjectionParams } from './tracking/project';
import { useTypefaces } from './useTypefaces';

/**
 * The journey on an old-fashioned postal map: Natural Earth coastlines inked by hand,
 * waterlined seas, dashed borders, names in their own languages. The route is pencilled
 * in; the travelled part is inked; the envelope waits at the last scan, and during long
 * silences a pencil mark guesses where it probably is.
 */

type MapData = {
  width: number;
  height: number;
  projection: ProjectionParams;
  land: string;
  borders: string;
  highlight: { fr: string; by: string };
  labels: { id: string; name: string; x: number; y: number }[];
  seas: { name: string; x: number; y: number }[];
};
const MAP = mapData as MapData;

const CITIES: { name: { fr: string; ru: string }; lat: number; lon: number; dx?: number; dy?: number }[] = [
  { name: { fr: 'Lille', ru: 'Лилль' }, lat: 50.637, lon: 3.063, dx: -1, dy: -1 },
  { name: { fr: 'Paris', ru: 'Париж' }, lat: 48.857, lon: 2.352, dx: -1, dy: 1.6 },
  { name: { fr: 'Bruxelles', ru: 'Брюссель' }, lat: 50.85, lon: 4.35 },
  { name: { fr: 'Berlin', ru: 'Берлин' }, lat: 52.52, lon: 13.405 },
  { name: { fr: 'Varsovie', ru: 'Варшава' }, lat: 52.23, lon: 21.012 },
  { name: { fr: 'Brest', ru: 'Брест' }, lat: 52.093, lon: 23.685, dy: 1.6 },
  { name: { fr: 'Minsk', ru: 'Минск' }, lat: 53.9, lon: 27.567 },
];

const INK = 'rgba(38, 34, 72, 0.9)';
const SEPIA = 'rgba(80, 58, 36, 0.62)';
const PENCIL = 'rgba(70, 64, 60, 0.42)';

function paperPaint(spec: PaperSpec, seed: number) {
  const effect = Skia.RuntimeEffect.Make(PAPER_SKSL)!;
  const p = Skia.Paint();
  p.setShader(effect.makeShader(paperUniforms(spec, { width: MAP.width, height: MAP.height }, seed, 0)));
  return p;
}

function spacedText(c: SkCanvas, text: string, cx: number, y: number, font: SkFont, paint: ReturnType<typeof Skia.Paint>, spacing: number) {
  const chars = [...text];
  const widths = font.getGlyphWidths(font.getGlyphIDs(text));
  const total = widths.reduce((s, w) => s + w, 0) + spacing * (chars.length - 1);
  let x = cx - total / 2;
  chars.forEach((ch, i) => {
    c.drawText(ch, x, y, paint, font);
    x += widths[i] + spacing;
  });
}

/** The static map, baked once per size. Sizes are given in screen points and divided by the zoom. */
function recordMap(faces: { print: SkTypeface; printBold: SkTypeface }, zoom: number, lang: Lang, seed: number): SkPicture {
  const pt = (v: number) => v / zoom;
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(0, 0, MAP.width, MAP.height));
  const land = Skia.Path.MakeFromSVGString(MAP.land)!;
  const borders = Skia.Path.MakeFromSVGString(MAP.borders)!;

  // Sea: tinted paper, with waterlines echoing the coast.
  c.drawRect(Skia.XYWHRect(0, 0, MAP.width, MAP.height), paperPaint({ ...PAPERS.cotton, base: [0.83, 0.87, 0.86] }, seed));
  [3, 6.5, 10.5, 15].forEach((d, i) => {
    const wl = Skia.Paint();
    wl.setStyle(PaintStyle.Stroke);
    wl.setStrokeWidth(pt(d * 2));
    wl.setColor(Skia.Color(`rgba(60, 96, 118, ${0.07 - i * 0.012})`));
    wl.setAntiAlias(true);
    c.drawPath(land, wl);
  });

  // Land: warm paper; the two countries of the couple washed in watercolour.
  c.drawPath(land, paperPaint({ ...PAPERS.cotton, base: [0.95, 0.91, 0.83] }, seed + 1));
  const wash = (svg: string, color: string) => {
    const p = Skia.Paint();
    p.setColor(Skia.Color(color));
    p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, pt(1.5), true));
    c.drawPath(Skia.Path.MakeFromSVGString(svg)!, p);
  };
  wash(MAP.highlight.fr, 'rgba(196, 120, 92, 0.13)');
  wash(MAP.highlight.by, 'rgba(110, 150, 96, 0.15)');

  // Coast inked by hand: a wobbly line over a fine one.
  const coast = Skia.Paint();
  coast.setStyle(PaintStyle.Stroke);
  coast.setAntiAlias(true);
  coast.setColor(Skia.Color(SEPIA));
  coast.setStrokeWidth(pt(0.9));
  coast.setPathEffect(Skia.PathEffect.MakeDiscrete(pt(5), pt(0.35), seed % 97));
  c.drawPath(land, coast);
  const fine = coast.copy();
  fine.setPathEffect(null);
  fine.setStrokeWidth(pt(0.45));
  c.drawPath(land, fine);

  // Borders: dash-dot, as on old atlases.
  const border = Skia.Paint();
  border.setStyle(PaintStyle.Stroke);
  border.setAntiAlias(true);
  border.setStrokeWidth(pt(0.7));
  border.setColor(Skia.Color('rgba(110, 80, 60, 0.55)'));
  border.setPathEffect(Skia.PathEffect.MakeDash([pt(5), pt(2.2), pt(1.1), pt(2.2)], 0));
  c.save();
  c.clipPath(land, ClipOp.Intersect, true);
  c.drawPath(borders, border);
  c.restore();

  // Names in their own languages; seas in italic-ish spaced capitals.
  const country = Skia.Paint();
  country.setColor(Skia.Color('rgba(92, 70, 50, 0.5)'));
  country.setAntiAlias(true);
  const countryFont = Skia.Font(faces.printBold, pt(8.5));
  for (const l of MAP.labels) spacedText(c, l.name, l.x, l.y, countryFont, country, pt(2.2));
  const sea = Skia.Paint();
  sea.setColor(Skia.Color('rgba(50, 86, 110, 0.5)'));
  const seaFont = Skia.Font(faces.print, pt(7));
  for (const s of MAP.seas) spacedText(c, s.name, s.x, s.y, seaFont, sea, pt(1.6));

  // Cities: a dot and a name.
  const dot = Skia.Paint();
  dot.setColor(Skia.Color('rgba(50, 40, 30, 0.8)'));
  const cityFont = Skia.Font(faces.print, pt(8));
  for (const city of CITIES) {
    const [x, y] = project(MAP.projection, city.lon, city.lat);
    c.drawCircle(x, y, pt(1.6), dot);
    const name = city.name[lang];
    const w = cityFont.getGlyphWidths(cityFont.getGlyphIDs(name)).reduce((s, v) => s + v, 0);
    const dx = city.dx === -1 ? -w - pt(4) : pt(4);
    c.drawText(name, x + dx, y + pt(3) * (city.dy ?? 0) + pt(3), dot, cityFont);
  }

  // Neat line: the double rule around an atlas plate.
  const frame = Skia.Paint();
  frame.setStyle(PaintStyle.Stroke);
  frame.setColor(Skia.Color('rgba(70, 52, 36, 0.7)'));
  frame.setStrokeWidth(pt(1.2));
  c.drawRect(Skia.XYWHRect(pt(6), pt(6), MAP.width - pt(12), MAP.height - pt(12)), frame);
  return rec.finishRecordingAsPicture();
}

type Props = {
  itinerary: Itinerary;
  now: Date;
  width: number;
  lang: Lang;
  /**
   * Where the letter probably is now (0..1 along the route), from the server's
   * tracking_estimate: a real letter's silent waypoints never reach the client.
   * Omit to estimate from a full itinerary (lab); null hides the guess.
   */
  estimate?: number | null;
};

export function TrackingMap({ itinerary, now, width, lang, estimate }: Props) {
  const faces = useTypefaces();
  const height = Math.round(width * 0.66);
  const seed = Number.parseInt(itinerary.s10.replace(/\D/g, '').slice(0, 6), 10);

  // Route in map coordinates, and a viewport framing it.
  const route = useMemo(() => {
    const pts = FR_BY_POLYLINE.map((v) => project(MAP.projection, v.lon, v.lat));
    const b = Skia.PathBuilder.Make().moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) b.lineTo(pts[i][0], pts[i][1]);
    const path = b.detach();
    // Projected length fraction of each vertex (the trim and the LUT work in screen length).
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const pf = acc.map((d) => d / acc[acc.length - 1]);
    // Position/tangent lookup table along the route, for the envelope.
    const measure = Skia.ContourMeasureIter(path, false, 1).next()!;
    const len = measure.length();
    const lut: number[] = [];
    for (let i = 0; i <= 128; i++) {
      const [p, t] = measure.getPosTan((len * i) / 128);
      lut.push(p.x, p.y, Math.atan2(t.y, t.x));
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    // Room around the route: more below, where the first postmarks hang.
    const margin = 70;
    let vx = Math.min(...xs) - margin * 1.3;
    let vw = Math.max(...xs) - vx + margin;
    let vy = Math.min(...ys) - margin;
    let vh = Math.max(...ys) - vy + margin * 1.5;
    // Match the canvas aspect.
    const aspect = height / width;
    if (vh / vw < aspect) {
      const nh = vw * aspect;
      vy -= (nh - vh) / 2;
      vh = nh;
    } else {
      const nw = vh / aspect;
      vx -= (nw - vw) / 2;
      vw = nw;
    }
    return { path, pts, pf, lut, view: { x: vx, y: vy, w: vw, h: vh } };
  }, [height, width]);

  const zoom = width / route.view.w;
  const picture = useMemo(() => faces && recordMap(faces, zoom, lang, seed), [faces, zoom, lang, seed]);

  // Distance fraction (haversine, from the itinerary) → projected length fraction.
  const fr = useMemo(() => routeFractions(), []);
  const toProj = (t: number) => {
    for (let i = 1; i < fr.length; i++) {
      if (t <= fr[i]) {
        const u = (t - fr[i - 1]) / Math.max(fr[i] - fr[i - 1], 1e-9);
        return route.pf[i - 1] + u * (route.pf[i] - route.pf[i - 1]);
      }
    }
    return 1;
  };

  const nowMs = now.getTime();
  const seen = itinerary.events.filter((e) => e.visible && Date.parse(e.at) <= nowMs);
  const last = seen[seen.length - 1];
  const target = last ? toProj(last.routeT) : 0;
  const delivered = last?.code === 'EMI';
  const silentHours = last ? (nowMs - Date.parse(last.at)) / 3600e3 : 0;
  const guess = toProj(estimate === undefined ? estimatedRouteT(itinerary, now) : (estimate ?? 0));
  const showGuess = estimate !== null && !!last && !delivered && silentHours >= 18 && guess - target > 0.01;

  // Inked trail: replayed from the start when the screen opens, then follows the clock.
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.set(withTiming(target, { duration: shown.get() === 0 ? 2500 : 900, easing: Easing.inOut(Easing.cubic) }));
  }, [target, shown]);

  const lut = route.lut;
  const envelope = useDerivedValue(() => {
    const f = Math.min(1, Math.max(0, shown.get())) * 128;
    const i = Math.min(127, Math.floor(f));
    const u = f - i;
    const x = lut[i * 3] + (lut[i * 3 + 3] - lut[i * 3]) * u;
    const y = lut[i * 3 + 1] + (lut[i * 3 + 4] - lut[i * 3 + 1]) * u;
    return [{ translateX: x }, { translateY: y }, { rotate: lut[i * 3 + 2] }];
  });

  const guessPoint = useMemo(() => {
    const f = Math.min(1, Math.max(0, guess)) * 128;
    const i = Math.min(127, Math.floor(f));
    return { x: lut[i * 3], y: lut[i * 3 + 1] };
  }, [guess, lut]);

  // Hub postmarks: one per place reached, dated with the first scan there.
  // (cheap: a handful of scans, computed each render)
  const hubs = (() => {
    const out: { x: number; y: number; at: number; label: string; tz: string }[] = [];
    for (const e of seen) {
      const [x, y] = project(MAP.projection, e.place.lon, e.place.lat);
      if (out.some((h) => Math.hypot(h.x - x, h.y - y) < 14 / zoom)) continue;
      out.push({ x, y, at: Date.parse(e.at), label: (e.office ?? e.place.name.fr).split(' ')[0], tz: e.place.tz });
    }
    return out;
  })();

  const viewTransform = [{ scale: zoom }, { translateX: -route.view.x }, { translateY: -route.view.y }];
  const totalKm = routeLengthKm();
  const summary = last ? mapSummary(last.routeT * totalKm, totalKm, last.place.name[lang], lang) : '';

  if (!picture || !faces) return <View style={{ width, height }} />;
  const markFont = Skia.Font(faces.printBold, 6.5);
  const rand = mulberry32(subSeed(seed, 'map-marks'));

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <Canvas style={{ width, height }}>
        <Group transform={viewTransform}>
          <Picture picture={picture} />
          {/* planned route in pencil, travelled part in ink */}
          <Path path={route.path} style="stroke" strokeWidth={1.2 / zoom} color={PENCIL} strokeCap="round">
            <DashPathEffect intervals={[4 / zoom, 4 / zoom]} />
          </Path>
          <Path path={route.path} style="stroke" strokeWidth={2.2 / zoom} color={INK} strokeCap="round" start={0} end={shown} />
          {showGuess && (
            <>
              <Circle cx={guessPoint.x} cy={guessPoint.y} r={7 / zoom} style="stroke" strokeWidth={1 / zoom} color={PENCIL} />
              <SkiaText
                x={guessPoint.x + 9 / zoom}
                y={guessPoint.y - 8 / zoom}
                text={lang === 'ru' ? 'где-то здесь?' : 'par ici ?'}
                font={Skia.Font(faces.marker, 13 / zoom)}
                color="rgba(60, 54, 50, 0.7)"
              />
            </>
          )}
        </Group>

        {/* postmarks at the hubs it reached (screen space, so they stay legible) */}
        {hubs.map((h, i) => (
          <HubMark
            key={i}
            x={(h.x - route.view.x) * zoom}
            y={(h.y - route.view.y) * zoom}
            date={shortDate(h.at, h.tz, lang).replace(' ', ' ')}
            time={clock(h.at, h.tz)}
            label={h.label}
            font={markFont}
            rotate={wobble(rand, 0.2)}
            above={i % 2 === 0}
          />
        ))}

        {/* the envelope, parked at its last scan */}
        <Group transform={[{ scale: zoom }, { translateX: -route.view.x }, { translateY: -route.view.y }]}>
          <Group transform={envelope}>
            <Group transform={[{ scale: 1 / zoom }]}>
              <Rect x={-9} y={-6} width={18} height={12} color="rgba(0,0,0,0.25)">
                <BlurMask blur={2} style="normal" />
              </Rect>
              <Rect x={-9} y={-6.5} width={18} height={12} color={delivered ? '#efe6d2' : '#f4ecdb'} />
              <Path path={ENVELOPE_FLAP} style="stroke" strokeWidth={0.8} color="rgba(80, 60, 40, 0.7)" />
              <Rect x={-9} y={-6.5} width={18} height={12} style="stroke" strokeWidth={0.6} color="rgba(80, 60, 40, 0.6)" />
              {/* registered: the red R label */}
              <Rect x={-8} y={-5.5} width={5} height={4} color="#c8102e" />
            </Group>
          </Group>
        </Group>
      </Canvas>
    </View>
  );
}

const ENVELOPE_FLAP: SkPath = (() => {
  const b = Skia.PathBuilder.Make();
  b.moveTo(-9, -6.5).lineTo(0, 0.5).lineTo(9, -6.5);
  return b.detach();
})();

/** A tiny calendar postmark: ring, short place name, date. */
function HubMark({
  x,
  y,
  date,
  time,
  label,
  font,
  rotate,
  above,
}: {
  x: number;
  y: number;
  date: string;
  time: string;
  label: string;
  font: SkFont;
  rotate: number;
  above: boolean;
}) {
  const r = 15;
  const cy = above ? y - r - 6 : y + r + 6;
  const w = (s: string) => font.getGlyphWidths(font.getGlyphIDs(s)).reduce((a, b) => a + b, 0);
  const ink = 'rgba(52, 38, 92, 0.78)';
  return (
    <Group>
      <Path
        path={Skia.PathBuilder.Make().moveTo(x, y).lineTo(x, above ? cy + r : cy - r).detach()}
        style="stroke"
        strokeWidth={0.6}
        color="rgba(52, 38, 92, 0.35)"
      />
      <Circle cx={x} cy={y} r={2.2} color={ink} />
      <Group origin={{ x, y: cy }} transform={[{ rotate }]}>
        <Circle cx={x} cy={cy} r={r} color="rgba(250, 246, 236, 0.85)" />
        <Circle cx={x} cy={cy} r={r} style="stroke" strokeWidth={1} color={ink} />
        <Circle cx={x} cy={cy} r={r - 3} style="stroke" strokeWidth={0.5} color={ink} />
        <SkiaText x={x - w(label) / 2} y={cy - 3.5} text={label} font={font} color={ink} />
        <SkiaText x={x - w(date) / 2} y={cy + 3} text={date} font={font} color={ink} />
        <SkiaText x={x - w(time) / 2} y={cy + 9} text={time} font={font} color={ink} />
      </Group>
    </Group>
  );
}

