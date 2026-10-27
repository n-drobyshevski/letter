import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { router } from 'expo-router';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Choice } from '@/components/Choice';
import { useLabParams } from '@/lib/params';
import { ApronCanvas } from '@/letter/desk/ApronCanvas';
import { itemPicture, keptPicture, layoutKey } from '@/letter/desk/deskPictures';
import { DrawerBox } from '@/letter/desk/DrawerBox';
import { record, recordInkRing, recordPenGroove } from '@/letter/desk/items';
import { ITEM_MM, useDeskLayout } from '@/letter/desk/layout';
import {
  DRAWERS,
  ITEMS_BY_DRAWER,
  PENS,
  deskSeed,
  inUseOf,
  type DeskItem,
  type DeskLayout,
  type Rect,
} from '@/letter/desk/types';
import { Underlay } from '@/letter/desk/Underlay';
import { paperUniforms } from '@/letter/paperLayout';
import { PAPER_SKSL } from '@/letter/shaders';
import { paperFor } from '@/letter/sheet';
import { FONT_KEYS, INK_KINDS, SHEET_PAPERS, type FontKey, type InkKind, type SheetPaper } from '@/theme/kinds';
import type { Lang } from '@/letter/tracking/copy';
import { DESK, type Country } from '@/theme/stationery';

/**
 * Realism board for the writing desk (spec §6 WP-C): the desk top with the sous-main and a blank sheet
 * over the band of closed fronts; the three drawers pulled out (t = 1) side by side; every item at the
 * drawers' far scale and at the desk's near scale. `?country=by|fr` picks the desk; `?paper=&ink=&font=`
 * what is in use (an empty groove, an ink ring, the laptop's resting items); `?item=` lifts one in its drawer.
 */

const STATIC = Platform.OS === 'web';
const COUNTRIES = [
  { key: 'by', label: 'Минск · дуб' },
  { key: 'fr', label: 'Lille · noyer' },
] as const;

const valid = <K extends string>(v: string | undefined, list: readonly K[]) => (list.includes(v as K) ? (v as K) : undefined);

export default function DeskBoard() {
  const q = useLabParams();
  const insets = useSafeAreaInsets();
  const layout = useDeskLayout();
  const country: Country = q.country === 'fr' ? 'fr' : 'by';
  const lang: Lang = country === 'fr' ? 'fr' : 'ru';
  const seed = deskSeed(country);
  const look = {
    paper: valid<SheetPaper>(q.paper, SHEET_PAPERS) ?? 'grid',
    ink: valid<InkKind>(q.ink, INK_KINDS) ?? 'violet',
    font: valid<FontKey>(q.font, FONT_KEYS) ?? 'marckScript',
  };
  const inUse = inUseOf(look, { paper: 'cream', liner: 'postal' });

  // The desk top: the sheet with wood above and below the pad.
  const { sheet, band, pad } = layout;
  const topH = Math.round(sheet.height + 2 * pad.marginY + 64);
  const sheetRect: Rect = {
    x: Math.round((layout.width - sheet.width) / 2),
    y: Math.round(32 + pad.marginY),
    width: sheet.width,
    height: sheet.height,
  };
  const deepest = Math.max(...DRAWERS.map((d) => layout.drawers[d].depth));

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}>
      <View style={styles.head}>
        <Text style={styles.title}>Стол</Text>
        <Choice options={COUNTRIES} value={country} onChange={(c) => router.setParams({ country: c })} />
      </View>

      <Text style={styles.section}>Desk top and the band (closed)</Text>
      <View testID="board-desk" style={{ width: layout.width, height: topH + band.height, overflow: 'hidden' }}>
        <Underlay
          layout={layout}
          preset={country}
          seed={seed}
          sheetRect={sheetRect}
          contentHeight={topH}
          resting={layout.resting === 'sides' ? inUse : null}
        />
        <BlankSheet paper={look.paper} rect={sheetRect} seed={q.seed ?? 7} />
        <ApronCanvas
          layout={layout}
          preset={country}
          seed={seed}
          lang={lang}
          style={{ position: 'absolute', left: 0, top: topH }}
        />
      </View>

      <Text style={styles.section}>The drawers, pulled out (t = 1)</Text>
      <View testID="board-drawers" style={{ width: layout.width, height: deepest + band.fronts + 12 }}>
        {DRAWERS.map((d) => {
          const f = layout.fronts[d];
          const depth = layout.drawers[d].depth;
          return (
            <DrawerBox
              key={d}
              drawer={d}
              layout={layout}
              preset={country}
              seed={seed}
              inUse={inUse}
              lifted={q.item}
              lang={lang}
              style={{ position: 'absolute', left: f.x, top: deepest - depth + 6 }}
            />
          );
        })}
      </View>

      <Text style={styles.section}>Items at the drawers&apos; scale ({layout.far} pt/mm)</Text>
      <ItemSheets testID="board-far" layout={layout} scale={layout.far} seed={seed} />
      <Text style={styles.section}>Items at the desk&apos;s scale ({layout.near.toFixed(2)} pt/mm)</Text>
      <ItemSheets testID="board-near" layout={layout} scale={layout.near} seed={seed} />
    </ScrollView>
  );
}

/** A blank sheet of the paper in use, where the letter would lie. */
function BlankSheet({ paper, rect, seed }: { paper: SheetPaper; rect: Rect; seed: number }) {
  const picture = keptPicture(`board-sheet:${paper}:${rect.width}:${seed}`, () =>
    record({ x: 0, y: 0, width: rect.width, height: rect.height }, (c) => {
      const p = Skia.Paint();
      p.setShader(Skia.RuntimeEffect.Make(PAPER_SKSL)!.makeShader(paperUniforms(paperFor(paper, rect.width), rect, seed, 0)));
      c.drawRect(Skia.XYWHRect(0, 0, rect.width, rect.height), p);
    }),
  );
  return (
    <Canvas
      style={StyleSheet.flatten([styles.abs, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }])}
      __destroyWebGLContextAfterRender={STATIC}
    >
      <Picture picture={picture} />
    </Canvas>
  );
}

const GAP = 14;

/** Items laid out in rows, wrapping at `width`; each pen on its own row. */
function layoutItems(items: readonly DeskItem[], width: number, scale: number) {
  const size = (item: DeskItem) => {
    switch (item.kind) {
      case 'paper':
        return { w: ITEM_MM.stack.w * scale, h: ITEM_MM.stack.h * scale };
      case 'envelope':
        return { w: ITEM_MM.envelope.w * scale, h: ITEM_MM.envelope.h * scale };
      case 'pen':
        return { w: PENS[item.pen].lengthMm * scale, h: ITEM_MM.penDiameter[item.pen] * scale };
      case 'ink':
        return { w: ITEM_MM.bottle * scale, h: ITEM_MM.bottle * scale };
    }
  };
  const placed: { item: DeskItem; rect: Rect }[] = [];
  let x = GAP;
  let y = GAP;
  let row = 0;
  for (const item of items) {
    const s = size(item);
    if (x > GAP && (x + s.w > width - GAP || item.kind === 'pen')) {
      x = GAP;
      y += row + GAP;
      row = 0;
    }
    placed.push({ item, rect: { x, y, width: s.w, height: s.h } });
    x += s.w + GAP;
    row = Math.max(row, s.h);
  }
  return { placed, height: y + row + GAP };
}

/**
 * Every item at one scale, one canvas per kind (a phone's near scale would make one canvas taller than a
 * GPU texture): the paper stacks, the envelopes, the pens in their grooves, the bottles with an ink ring
 * and an empty groove beside them.
 */
function ItemSheets({ layout, scale, seed, testID }: { layout: DeskLayout; scale: number; seed: number; testID: string }) {
  const width = Math.min(layout.width, 1100);
  // One canvas per row of paper or envelopes, so none grows taller than a GPU texture.
  const rowsOf = (items: readonly DeskItem[]) => {
    const { placed } = layoutItems(items, width, scale);
    const rows = new Map<number, DeskItem[]>();
    for (const { item, rect } of placed) rows.set(rect.y, [...(rows.get(rect.y) ?? []), item]);
    return [...rows.values()];
  };
  const pens = ITEMS_BY_DRAWER.pens.filter((i) => i.kind === 'pen');
  const inks = ITEMS_BY_DRAWER.pens.filter((i) => i.kind === 'ink');
  const groups = [...rowsOf(ITEMS_BY_DRAWER.paper), ...rowsOf(ITEMS_BY_DRAWER.envelopes), pens, inks];
  const last = groups.length - 1;
  return (
    <View testID={testID} style={styles.sheets}>
      {groups.map((items, g) => {
        const { placed, height } = layoutItems(items, width, scale);
        const extra = g === last ? ITEM_MM.bottle * scale + GAP : 0;
        const total = height + extra;
        const picture = keptPicture(`board-items:${layoutKey(layout)}:${scale}:${seed}:${g}`, () =>
          record({ x: 0, y: 0, width, height: total }, (c) => {
            for (const { item, rect } of placed) {
              c.save();
              c.translate(rect.x, rect.y);
              if (item.kind === 'pen') c.drawPicture(recordPenGroove(item.pen, scale, false));
              c.drawPicture(itemPicture(item, scale, seed));
              c.restore();
            }
            if (g === last) {
              // Where the violet bottle stood, and the groove of the pen in hand.
              c.save();
              c.translate(GAP, height);
              c.drawPicture(recordInkRing('violet', scale, seed));
              c.translate(ITEM_MM.bottle * scale + 2 * GAP, ((ITEM_MM.bottle - ITEM_MM.penDiameter.broad) * scale) / 2);
              c.drawPicture(recordPenGroove('broad', scale, true));
              c.restore();
            }
          }),
        );
        return (
          <View key={g} style={[styles.items, { width, height: total }]}>
            <Canvas
              style={StyleSheet.flatten([styles.abs, { left: 0, top: 0, width, height: total }])}
              __destroyWebGLContextAfterRender={STATIC}
            >
              <Picture picture={picture} />
            </Canvas>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DESK.floor[1] },
  head: { alignItems: 'center', gap: 8, paddingBottom: 8 },
  title: { color: '#efe2cc', fontSize: 22, fontFamily: 'MarckScript_400Regular' },
  section: { color: '#b9a88f', fontSize: 13, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  abs: { position: 'absolute' },
  sheets: { alignItems: 'center', gap: 4 },
  items: { backgroundColor: '#2f3f35' },
});
