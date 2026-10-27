import { ImageShader, Path, Rect, Shader, Skia, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { LIGHT_DIR, WAX, type WaxKind } from '../theme/stationery';
import { useDie } from './dieImage';
import { sealBounds, sealCrack, shaderSeed, outline, type SealDie, type SealPx } from './seal';
import { WAX_SKSL } from './shaders';

let waxEffect: ReturnType<typeof Skia.RuntimeEffect.Make> = null;
// Created lazily: on web, CanvasKit is only ready once the app has mounted.
const waxShader = () => (waxEffect ??= Skia.RuntimeEffect.Make(WAX_SKSL));

type Num = SharedValue<number> | number;
type Live<T> = SharedValue<T> | T;

const isShared = <T extends object>(v: Live<T>): v is SharedValue<T> => {
  'worklet';
  return typeof v === 'object' && v !== null && 'get' in v && typeof (v as { get?: unknown }).get === 'function';
};

/**
 * Sealing wax on an envelope, envelope-local pt, poured and pressed anywhere.
 *
 * `placement` (SealPx, from seal.ts's sealToPx) says where the puddle is and where the die
 * went in. Live ceremonies pass a shared value the gestures update; static seals (posting,
 * receiving, the broken halves) a plain object resolved from the stored envelope look
 * (seal.ts's defaultSeal for letters stored without one).
 *
 * `pour` (0..1) grows the puddle to placement.r (r·√pour); `imprint` (0..1) is the die's
 * travel (the press spread is in the shader); `molten` (0..1) is the gloss, by default
 * 1 − 0.85·imprint. The seal casts its own soft shadow from inside the shader.
 */
export function WaxSeal({
  placement,
  die = 'monogram',
  initials,
  wax,
  seed,
  pour = 1,
  imprint = 1,
  molten,
  dieR,
  cracked = false,
  flexible = false,
  light,
}: {
  placement: Live<SealPx>;
  die?: SealDie;
  initials: string;
  wax: WaxKind;
  /** The envelope's seed: the crack. */
  seed: number;
  pour?: Num;
  imprint?: Num;
  molten?: Num;
  /**
   * The die's radius (pt), for the texture's resolution. Defaults to a plain placement's
   * stamp.r; pass it with a shared placement whose stamp is still null (before the press).
   */
  dieR?: number;
  /** A hairline crack from the trip through the post (static placements only). */
  cracked?: boolean;
  /** Flexible (glue-gun) wax: it bends, so a late press leaves no cracks at the rim. */
  flexible?: boolean;
  /**
   * The desk light in this seal's own (envelope-local) space; LIGHT_DIR by default. A seal
   * on an envelope turned on screen (posting into the RU slot) passes it turned back.
   */
  light?: Live<[number, number]>;
}) {
  const source = placement;
  const plain = isShared(source) ? null : source;
  const dieImg = useDie(die, initials, dieR ?? plain?.stamp?.r ?? (plain ? plain.r * 0.72 : 20));

  const read = (v: Num) => {
    'worklet';
    return typeof v === 'number' ? v : v.get();
  };
  const resolved = useDerivedValue(() => {
    const s = isShared(source) ? source.get() : source;
    return { ...s, r: s.r * Math.sqrt(Math.max(read(pour), 0)) };
  });
  const dieSize = dieImg?.size ?? 1;
  const color = WAX[wax].rgb as unknown as number[];
  const uniforms = useDerivedValue(() => {
    const s = resolved.get();
    const st = s.stamp;
    const t = st ? read(imprint) : 0;
    const a = s.drops[0] ?? [0, 0, 0];
    const b = s.drops[1] ?? [0, 0, 0];
    return {
      uDieSize: dieSize,
      uCenter: vec(s.x, s.y),
      uR: s.r,
      uStretch: s.stretch,
      uDropA: a,
      uDropB: b,
      uStamp: st ? vec(st.x, st.y) : vec(s.x, s.y),
      uStampR: st ? Math.max(st.r, 1) : Math.max(s.r * 0.72, 1),
      uAngle: st?.angle ?? 0,
      uImprint: t,
      uDepth: st?.depth ?? 0,
      uMolten: molten === undefined ? 1 - 0.85 * t : read(molten),
      uSeed: shaderSeed(s.seed),
      uColor: color,
      uLight: light === undefined ? [LIGHT_DIR.x, LIGHT_DIR.y] : isShared(light) ? light.get() : light,
      uFlex: flexible ? 1 : 0,
    };
  });
  // The shader's rect: wax, lip, drops, an overhanging die and the shadow it casts. Nothing
  // before the first drop (the in-shader shadow would otherwise show a dot).
  const box = useDerivedValue(() => {
    const s = resolved.get();
    const empty = s.r < 0.3 && !s.drops.some((d) => d[2] > 0);
    return empty ? null : sealBounds(s);
  });
  const x = useDerivedValue(() => box.get()?.x ?? 0);
  const y = useDerivedValue(() => box.get()?.y ?? 0);
  const w = useDerivedValue(() => box.get()?.width ?? 0);
  const h = useDerivedValue(() => box.get()?.height ?? 0);

  const staticPour = typeof pour === 'number' ? pour : 1;
  const crack = useMemo(() => {
    if (!cracked || !plain) return null;
    return polyline(sealCrack({ ...plain, r: plain.r * Math.sqrt(Math.max(staticPour, 0)) }, seed), false);
  }, [cracked, plain, staticPour, seed]);

  if (!dieImg) return null;
  return (
    <>
      <Rect x={x} y={y} width={w} height={h}>
        <Shader source={waxShader()!} uniforms={uniforms}>
          {/* image space = shader space: the shader places, scales and turns the die itself */}
          <ImageShader image={dieImg.image} x={0} y={0} width={dieImg.size} height={dieImg.size} fit="fill" tx="decal" ty="decal" />
        </Shader>
      </Rect>
      {crack && (
        <>
          {/* the crack: a dark hairline with a lit lip just below it */}
          <Path path={crack} style="stroke" strokeWidth={0.7} color="rgba(20, 4, 4, 0.75)" transform={[{ translateY: -0.3 }]} />
          <Path path={crack} style="stroke" strokeWidth={0.5} color="rgba(255, 210, 200, 0.22)" transform={[{ translateY: 0.6 }]} />
        </>
      )}
    </>
  );
}

/** [x0, y0, x1, y1, …] → an immutable path. */
function polyline(pts: number[], close: boolean) {
  const b = Skia.PathBuilder.Make();
  b.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) b.lineTo(pts[i], pts[i + 1]);
  if (close) b.close();
  return b.detach();
}

/**
 * The wax's footprint after the press as a Skia path (the flexible-wax film, clips, hit
 * areas): the main body from seal.ts's outline, plus the satellite drops as circles.
 */
export function sealOutlinePath(p: SealPx) {
  const b = Skia.PathBuilder.MakeFromPath(polyline(outline(p), true));
  for (const [dx, dy, dr] of p.drops) if (dr > 0) b.addCircle(dx, dy, dr);
  return b.detach();
}

/** The transit crack across a seal (seal.ts's sealCrack) as a path. */
export const sealCrackSkPath = (p: SealPx, seed: number) => polyline(sealCrack(p, seed), false);
