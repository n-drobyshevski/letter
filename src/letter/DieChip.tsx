import { Canvas, Circle, Group, Path, Text, useFont, type SkFont } from '@shopify/react-native-skia';
import { useMemo } from 'react';

import { HANDWRITING_FONTS, LIGHT_DIR, WAX, type WaxKind } from '../theme/stationery';
import { diePaths } from './dieImage';
import { SEAL_BOX, type SealDie } from './sealDies';

// The emboss offsets (px), along the desk light: a lit copy towards it, a shadow away from it.
const L = Math.hypot(LIGHT_DIR.x, LIGHT_DIR.y);
const EMBOSS = { x: (LIGHT_DIR.x / L) * 0.85, y: (LIGHT_DIR.y / L) * 0.85 };

const rgb = (c: readonly number[], k = 1, a = 1) =>
  `rgba(${Math.round(Math.min(1, c[0] * k) * 255)}, ${Math.round(Math.min(1, c[1] * k) * 255)}, ${Math.round(Math.min(1, c[2] * k) * 255)}, ${a})`;
const lighten = (c: readonly number[], t: number) => c.map((v) => v + (1 - v) * t);

/** The monogram chip's font size for a mark `size` px across. */
const markFontSize = (size: number, initials: string) => size * (initials.length > 1 ? 0.5 : 0.72);

/**
 * The monogram chip's font, loaded by whoever mounts first (the sealing screen, long before
 * its tray shows), so the chip never appears blank while Marck Script loads.
 */
export function useDieMarkFont(initials: string, size = 24) {
  return useFont(HANDWRITING_FONTS.marckScript.file, markFontSize(size, initials));
}

/**
 * A die as a picker chip, drawn flat in the wax colour with a two-layer emboss (a lit copy
 * offset towards LIGHT_DIR and a shadow copy away from it): no runtime shader, so eight of
 * them in a tray cost nothing. Skia element: put it inside a Canvas, centred on (cx, cy),
 * `size` px across (the die's diameter; 24 in the tray). 'monogram' shows its beaded border
 * and the initials in Marck Script.
 */
export function DieMark({
  die,
  wax,
  cx,
  cy,
  size = 24,
  initials = '',
  font: given,
}: {
  die: SealDie;
  wax: WaxKind;
  cx: number;
  cy: number;
  size?: number;
  initials?: string;
  /** The monogram's font (useDieMarkFont), when the screen preloads it; else the chip loads its own. */
  font?: SkFont | null;
}) {
  const paths = diePaths(die);
  const c = WAX[wax].rgb;
  const k = size / SEAL_BOX;
  const mono = die === 'monogram';
  const own = useFont(mono && given === undefined ? HANDWRITING_FONTS.marckScript.file : null, markFontSize(size, initials));
  const font = given === undefined ? own : given;
  const text = useMemo(() => {
    if (!mono || !font || !initials) return null;
    const w = font.getGlyphWidths(font.getGlyphIDs(initials)).reduce((s, x) => s + x, 0);
    const m = font.getMetrics();
    return { x: cx - w / 2, y: cy - (m.ascent + m.descent) / 2 };
  }, [mono, font, initials, cx, cy]);

  const layer = (dx: number, dy: number, color: string, key: string) => (
    <Group key={key} transform={[{ translateX: cx - size / 2 + dx }, { translateY: cy - size / 2 + dy }, { scale: k }]}>
      {paths.map((p, i) => (
        <Path key={i} path={p} color={color} />
      ))}
    </Group>
  );
  const textLayer = (dx: number, dy: number, color: string, key: string) =>
    text && font ? <Text key={key} x={text.x + dx} y={text.y + dy} text={initials} font={font} color={color} /> : null;

  const lit = rgb(lighten(c, 0.55), 1, 0.85);
  const shade = rgb(c, 0.3, 0.75);
  const face = rgb(c);
  // Until the font is there, a small embossed boss stands in for the initials (never an empty disc).
  const boss = mono && initials && !text;
  return (
    <Group>
      {layer(-EMBOSS.x, -EMBOSS.y, shade, 'shade')}
      {textLayer(-EMBOSS.x, -EMBOSS.y, shade, 'tshade')}
      {boss && <Circle cx={cx - EMBOSS.x} cy={cy - EMBOSS.y} r={size * 0.14} color={shade} />}
      {layer(EMBOSS.x, EMBOSS.y, lit, 'lit')}
      {textLayer(EMBOSS.x, EMBOSS.y, lit, 'tlit')}
      {boss && <Circle cx={cx + EMBOSS.x} cy={cy + EMBOSS.y} r={size * 0.14} color={lit} />}
      {layer(0, 0, face, 'face')}
      {textLayer(0, 0, face, 'tface')}
      {boss && <Circle cx={cx} cy={cy} r={size * 0.14} color={face} />}
    </Group>
  );
}

/**
 * A standalone chip: one small Canvas with a DieMark centred in it. Fine for a few; a tray
 * of eight is better drawn as DieMarks inside one Canvas (each web Canvas is a GL context).
 */
export function DieChip({
  die,
  wax,
  size = 44,
  mark = 24,
  initials,
}: {
  die: SealDie;
  wax: WaxKind;
  size?: number;
  mark?: number;
  initials?: string;
}) {
  return (
    <Canvas style={{ width: size, height: size }}>
      <DieMark die={die} wax={wax} cx={size / 2} cy={size / 2} size={mark} initials={initials} />
    </Canvas>
  );
}
