import {
  BlurMask,
  Circle,
  ImageShader,
  Path,
  Rect,
  Shader,
  Skia,
  drawAsImageFromPicture,
  useFont,
  vec,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { HANDWRITING_FONTS, LIGHT_DIR, WAX, type WaxKind } from '../theme/stationery';
import { recordMonogram, type EnvelopeGeometry } from './envelope';
import { sealCrackPath } from './envelopeFront';
import { WAX_SKSL } from './shaders';

let waxEffect: ReturnType<typeof Skia.RuntimeEffect.Make> = null;
// Created lazily: on web, CanvasKit is only ready once the app has mounted.
const waxShader = () => (waxEffect ??= Skia.RuntimeEffect.Make(WAX_SKSL));

/** The stamp's engraving (initials + ring) as an alpha image the wax shader reads as height. */
export function useMonogram(initials: string, stampR: number) {
  const font = useFont(HANDWRITING_FONTS.marckScript.file, stampR * 2 * (initials.length > 1 ? 0.62 : 0.95));
  return useMemo(() => {
    if (!font) return null;
    const size = Math.ceil(stampR * 2 * 2); // 2× for a crisp relief
    return drawAsImageFromPicture(recordMonogram(initials, font, size), { width: size, height: size });
  }, [font, stampR, initials]);
}

type Animated = SharedValue<number>;

/**
 * Sealing wax on an envelope, in envelope-local coordinates.
 * `pour` (0..1) is how much wax was poured; `imprint` (0..1) how far the stamp has pressed.
 * Static seals (posting, receiving) pass plain numbers.
 */
export function WaxSeal({
  seal,
  wax,
  initials,
  seed,
  pour,
  imprint,
  cracked = false,
}: {
  seal: EnvelopeGeometry['seal'];
  wax: WaxKind;
  initials: string;
  seed: number;
  pour: Animated | number;
  imprint: Animated | number;
  /** A hairline crack from the trip through the post. */
  cracked?: boolean;
}) {
  const monogram = useMonogram(initials, seal.stampR);
  const read = (v: Animated | number) => {
    'worklet';
    return typeof v === 'number' ? v : v.get();
  };
  const radius = useDerivedValue(() => seal.maxR * Math.sqrt(read(pour)) * (1 + 0.07 * read(imprint)));
  const uniforms = useDerivedValue(() => ({
    uCenter: vec(seal.x, seal.y),
    uR: radius.get(),
    uStampR: seal.stampR,
    uSeed: (seed % 97) * 0.37,
    uImprint: read(imprint),
    uMolten: 1 - 0.85 * read(imprint),
    uColor: WAX[wax].rgb as unknown as number[],
    uLight: [LIGHT_DIR.x, LIGHT_DIR.y],
  }));
  const shadowR = useDerivedValue(() => radius.get() * 0.97);
  const crack = useMemo(() => (cracked ? sealCrackPath(seal.x, seal.y, seal.maxR, seed) : null), [cracked, seal, seed]);

  if (!monogram) return null;
  return (
    <>
      <Circle cx={seal.x + 1.5} cy={seal.y + 2.5} r={shadowR} color="rgba(30, 8, 4, 0.4)">
        <BlurMask blur={3} style="normal" />
      </Circle>
      <Rect x={seal.x - seal.maxR * 1.4} y={seal.y - seal.maxR * 1.4} width={seal.maxR * 2.8} height={seal.maxR * 2.8}>
        <Shader source={waxShader()!} uniforms={uniforms}>
          <ImageShader
            image={monogram}
            x={seal.x - seal.stampR}
            y={seal.y - seal.stampR}
            width={seal.stampR * 2}
            height={seal.stampR * 2}
            fit="fill"
            tx="decal"
            ty="decal"
          />
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
