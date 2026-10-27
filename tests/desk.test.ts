import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deskLayout, FRONT_GAP, ITEM_MM, padRectFor, restingPlaces } from '../src/letter/desk/layout';
import { CARRY, liftOf, rubber, settleTarget, TAP } from '../src/letter/desk/motion';
import { applyPick, isBlankLetter, withoutDemo } from '../src/letter/desk/pick';
import { drawerSlots, HIT_MIN } from '../src/letter/desk/slots';
import {
  deskItem,
  DRAWERS,
  inUseOf,
  itemsFor,
  type DeskItem,
  type DeskItemId,
  type DeskLayoutInput,
  type InUse,
  type PickState,
  type Rect,
} from '../src/letter/desk/types';
import type { LetterLook } from '../src/letter/LetterSheet';
import { clampFace, emptyFace, emptySheet, isEmptySheet, type SheetContent } from '../src/letter/stack';

/** The writing desk's pure logic (spec §3.2, §3.3, §3.5, §4.1): geometry, motion rules, slots and picks. */

const VIEWPORTS: Record<string, DeskLayoutInput> = {
  'phone 390×844': { width: 390, height: 844, insets: { top: 47, bottom: 34 } },
  'small phone 375×667': { width: 375, height: 667, insets: { top: 20, bottom: 0 } },
  'laptop 1280×800': { width: 1280, height: 800, insets: { top: 0, bottom: 0 } },
  'laptop 1280×860': { width: 1280, height: 860, insets: { top: 0, bottom: 0 } },
};
const layouts = Object.entries(VIEWPORTS).map(([name, input]) => [name, deskLayout(input)] as const);

const item = (id: DeskItemId): DeskItem => deskItem(id)!;
const EPS = 1e-6;

// ---------------------------------------------------------------- motion

test('rubber: the tug never moves a front more than 6 pt at d 10, starts at slope c and pulls both ways', () => {
  assert.equal(rubber(0, 10), 0);
  let prev = 0;
  for (const x of [0.5, 1, 2, 5, 10, 20, 50, 100, 400, 2000, 1e6]) {
    const y = rubber(x, 10);
    assert.ok(y <= 6, `rubber(${x}) = ${y}`);
    assert.ok(y > prev, 'monotonic');
    assert.ok(y < x, 'always resisted');
    prev = y;
  }
  assert.ok(Math.abs(rubber(0.01, 10) / 0.01 - 0.55) < 0.01, 'initial slope is c');
  assert.equal(rubber(-20, 10), -rubber(20, 10));
  assert.equal(rubber(5, 0), 0);
});

test('settleTarget: projection and velocity decide open or closed (§3.3)', () => {
  const D = 96;
  assert.equal(settleTarget(0.44, 0, D), 0);
  assert.equal(settleTarget(0.46, 0, D), 1);
  assert.equal(settleTarget(0.1, -700, D), 1);
  assert.equal(settleTarget(0.9, 700, D), 0);
  // A gentle fling up from a third open projects past 0.45; a gentle push down from halfway projects under it.
  assert.equal(settleTarget(0.3, -200, D), 1);
  assert.equal(settleTarget(0.5, 200, D), 0);
  assert.equal(settleTarget(1, 0, D), 1);
  assert.equal(settleTarget(0, 0, D), 0);
});

test('liftOf: the camera follows the furthest-open drawer', () => {
  assert.equal(liftOf([0, 0, 0], [448, 246, 408]), 0);
  assert.equal(liftOf([1, 0, 0], [448, 246, 408]), 448);
  assert.equal(liftOf([0.2, 0.9, 0], [448, 246, 408]), 0.9 * 246);
  assert.equal(liftOf([], []), 0);
});

test('gesture constants are the spec’s', () => {
  assert.deepEqual(TAP, { maxMove: 6, maxMs: 250 });
  assert.deepEqual(CARRY, { activate: 8, offset: -56 });
});

// ---------------------------------------------------------------- layout

test('the reference phone: band rows, fronts 124 / 134 / 124, the paper drawer at t = 1 as drawn in §3.2', () => {
  const l = deskLayout(VIEWPORTS['phone 390×844']);
  assert.equal(l.mode, 'phone');
  assert.deepEqual(l.sheet, { width: 358, height: 506 });
  assert.equal(l.far, 0.68);
  assert.ok(Math.abs(l.near - 358 / 150) < EPS);
  assert.deepEqual(
    {
      top: l.band.top,
      height: l.band.height,
      nosing: l.band.nosing,
      fronts: l.band.fronts,
      rail: l.band.rail,
      knee: l.band.knee,
    },
    { top: 744, height: 100, nosing: 6, fronts: 44, rail: 4, knee: 12 },
  );
  assert.deepEqual(
    DRAWERS.map((k) => [l.fronts[k].x, l.fronts[k].width]),
    [
      [0, 124],
      [128, 134],
      [266, 124],
    ],
  );
  assert.deepEqual(
    DRAWERS.map((k) => [l.drawers[k].travel, l.drawers[k].depth, l.drawers[k].pan]),
    [
      [96, 352, 448],
      [96, 150, 246],
      [96, 312, 408],
    ],
  );
  const paper = l.drawers.paper;
  assert.equal(l.band.top - paper.pan, 296, 'desk edge');
  assert.equal(l.fronts.paper.y - paper.travel, 654, 'front top');
  assert.equal(l.fronts.paper.y - paper.travel + l.band.fronts, 698, 'front bottom');
  assert.deepEqual(paper.interior, { width: 114, height: 352 });
  assert.equal(l.resting, 'none');
  assert.deepEqual(l.pad, { fullBleed: true, marginX: 0, marginY: 24, fillets: [8], radius: 3 });
});

test('the laptop: 84 pt band, fronts 220 / 260 / 220 centred, sheet capped at 393 (800) and 435 (860), resting items', () => {
  for (const [h, sheet] of [
    [800, 393],
    [860, 435],
  ] as const) {
    const l = deskLayout({ width: 1280, height: h, insets: { top: 0, bottom: 0 } });
    assert.equal(l.mode, 'laptop');
    assert.equal(l.band.height, 84);
    assert.equal(l.far, 1);
    assert.equal(l.sheet.width, sheet);
    assert.equal(l.fronts.paper.x, (1280 - 716) / 2);
    assert.deepEqual(
      DRAWERS.map((k) => l.fronts[k].width),
      [220, 260, 220],
    );
    assert.deepEqual(
      DRAWERS.map((k) => l.drawers[k].pan),
      [564, 330, 552],
    );
    assert.equal(l.resting, 'sides');
    assert.deepEqual(l.pad.fillets, [12, 15]);
    assert.equal(l.pad.marginX, Math.max(22, 0.12 * sheet));
  }
});

for (const [name, l] of layouts) {
  test(`deskLayout ${name}: fronts, open drawers and the sheet fit the window`, () => {
    // Fronts at least 44 pt tall; on a phone they and their rails span the width exactly.
    const fronts = DRAWERS.map((k) => l.fronts[k]);
    for (const f of fronts) assert.ok(f.height >= 44, `front ${f.height} tall`);
    const gap = FRONT_GAP[l.mode];
    const span = fronts.reduce((a, f) => a + f.width, 0) + 2 * gap;
    if (l.mode === 'phone') assert.equal(span, l.width);
    else assert.ok(Math.abs(fronts[0].x - (l.width - (fronts[2].x + fronts[2].width))) < EPS, 'centred');
    for (let i = 1; i < fronts.length; i++) {
      assert.ok(Math.abs(fronts[i].x - (fronts[i - 1].x + fronts[i - 1].width + gap)) < EPS, 'one rail between fronts');
    }
    assert.equal(l.band.top + l.band.height, l.height);

    for (const k of DRAWERS) {
      const d = l.drawers[k];
      assert.equal(d.pan, d.depth + d.travel);
      assert.equal(d.interior.width, l.fronts[k].width - 10);
      // At t = 1 the open front stays on screen, clear of the home indicator.
      const top = l.fronts[k].y - d.travel;
      assert.ok(top >= 0, `${k} front top ${top}`);
      assert.ok(top + l.fronts[k].height <= l.height - l.insets.bottom - 20, `${k} front bottom ${top + l.fronts[k].height}`);
      // The desk edge (the band's top, panned by C) stays below the top inset + 40.
      assert.ok(l.band.top - d.pan >= l.insets.top + 40, `${k} desk edge ${l.band.top - d.pan}`);
    }

    if (l.mode === 'laptop') {
      // Title, hint, mode row, the pad above the sheet, and the sheet above the band, inside the window.
      const top = l.insets.top + 12 + 34 + 12 + 18 + 12 + 28 + 4 + l.pad.marginY;
      assert.ok(top + l.sheet.height + 12 + l.band.height <= l.height, `sheet ${l.sheet.height} + band`);
    } else {
      assert.equal(l.sheet.width, Math.round(Math.min(l.width - 32, 520)));
    }
    assert.equal(l.sheet.height, Math.round(l.sheet.width * Math.SQRT2));
  });
}

test('a short window shrinks the drawers’ depth (the stagger), never below what the items need', () => {
  const l = deskLayout({ width: 390, height: 520, insets: { top: 24, bottom: 0 } });
  const roomy = deskLayout(VIEWPORTS['phone 390×844']);
  assert.ok(l.drawers.paper.depth < roomy.drawers.paper.depth);
  assert.ok(l.band.top - l.drawers.paper.pan >= l.insets.top + 40);
  for (const k of DRAWERS) {
    const slots = drawerSlots(k, l, inUseOf(LOOK, { paper: 'cream', liner: 'postal' }));
    const same = drawerSlots(k, roomy, inUseOf(LOOK, { paper: 'cream', liner: 'postal' }));
    // Items keep their size (same width, same far scale).
    assert.deepEqual(
      slots.map((s) => [s.rect.width, s.rect.height]),
      same.map((s) => [s.rect.width, s.rect.height]),
    );
  }
});

test('padRectFor: full bleed with 24 pt above and below on a phone; the sheet plus margins on a laptop', () => {
  const phone = deskLayout(VIEWPORTS['phone 390×844']);
  const sheet: Rect = { x: 16, y: 120, width: 358, height: 506 };
  const p = padRectFor(phone, sheet);
  assert.ok(p.x < 0 && p.x + p.width > phone.width, 'runs off both sides');
  assert.equal(p.y, 96);
  assert.equal(p.height, 506 + 48);

  const laptop = deskLayout(VIEWPORTS['laptop 1280×860']);
  const s2: Rect = { x: (1280 - 435) / 2, y: 148, width: 435, height: 615 };
  const q = padRectFor(laptop, s2);
  assert.ok(Math.abs(q.x - (s2.x - 0.12 * 435)) < EPS);
  assert.ok(Math.abs(q.width - 435 * 1.24) < EPS);
  assert.ok(Math.abs(q.y - (148 - 28)) < EPS);
});

test('restingPlaces: none on a phone; on a laptop beside the pad, paper and envelope partly off screen', () => {
  const phone = deskLayout(VIEWPORTS['phone 390×844']);
  assert.equal(restingPlaces(phone, { x: 16, y: 120, width: 358, height: 506 }), null);

  const l = deskLayout(VIEWPORTS['laptop 1280×860']);
  const sheet: Rect = { x: (1280 - 435) / 2, y: 148, width: 435, height: 615 };
  const r = restingPlaces(l, sheet)!;
  const pad = padRectFor(l, sheet);
  const supplyW = ITEM_MM.supply.w * l.near;
  for (const p of Object.values(r)) assert.equal(p.scale, l.near);
  // Paper: left of the pad, at least 24 pt from it, no more than 40 % off the left edge.
  assert.ok(r.paper.x + supplyW / 2 <= pad.x - 24 + EPS);
  assert.ok(r.paper.x - supplyW / 2 >= -0.4 * supplyW - EPS);
  assert.ok(r.paper.x - supplyW / 2 < 0, 'runs off the left edge');
  assert.ok(Math.abs(r.paper.rotation + (3 * Math.PI) / 180) < EPS);
  // Pen and bottle right of the pad, the bottle above the pen; the envelope half off the right edge.
  assert.ok(r.pen.x > pad.x + pad.width && r.pen.x < l.width);
  assert.ok(Math.abs(r.pen.y - (sheet.y + 0.62 * sheet.height)) < EPS);
  assert.ok(r.bottle.y < r.pen.y);
  assert.equal(r.envelope.x, l.width);
  assert.ok(r.envelope.y > r.pen.y);
});

// ---------------------------------------------------------------- slots

const LOOK: LetterLook = { paper: 'grid', ink: 'blueBlack', font: 'badScript', seed: 7 };
const IN_USE: InUse = inUseOf(LOOK, { paper: 'cream', liner: 'postal' });

const inside = (r: Rect, box: { width: number; height: number }) =>
  r.x >= -EPS && r.y >= -EPS && r.x + r.width <= box.width + EPS && r.y + r.height <= box.height + EPS;

/** The rect's bounds once turned about its centre. */
function turned(r: Rect, rotation: number): Rect {
  const c = Math.abs(Math.cos(rotation));
  const s = Math.abs(Math.sin(rotation));
  const w = r.width * c + r.height * s;
  const h = r.width * s + r.height * c;
  return { x: r.x + r.width / 2 - w / 2, y: r.y + r.height / 2 - h / 2, width: w, height: h };
}

function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.min(w, h) : 0;
}

for (const [name, l] of layouts) {
  test(`drawerSlots ${name}: inside the interior, big enough to touch, not overlapping`, () => {
    for (const k of DRAWERS) {
      const { interior } = l.drawers[k];
      const slots = drawerSlots(k, l, IN_USE);
      assert.deepEqual(
        slots.map((s) => s.item.id),
        itemsFor(k).map((i) => i.id),
      );
      const stagger = k === 'pens' ? 0 : slots.length > 1 ? slots[0].rect.y - slots[1].rect.y : 0;
      if (k !== 'pens') assert.ok(stagger >= 22, `${k} stagger ${stagger}`);
      for (const s of slots) {
        assert.ok(inside(turned(s.rect, s.rotation), interior), `${s.item.id} rect inside ${k}`);
        assert.ok(inside(s.hit, interior), `${s.item.id} hit inside ${k}`);
        const long = Math.max(s.hit.width, s.hit.height);
        const short = Math.min(s.hit.width, s.hit.height);
        assert.ok(long >= HIT_MIN.long && short >= HIT_MIN.short, `${s.item.id} hit ${s.hit.width}×${s.hit.height}`);
        assert.ok(Math.abs(s.rotation) < (2 * Math.PI) / 180, 'barely turned');
        // Captions in the floor beside the box: right of paper, left of envelopes; the pen tray's on both sides.
        const left = s.caption.x < 0 && s.caption.align === 'right';
        const right = s.caption.x > interior.width && s.caption.align === 'left';
        if (k === 'envelopes') assert.ok(left);
        else if (k === 'paper') assert.ok(right);
        else assert.ok(left || right);
        // Level with its item's row (the bottles' pair straddles their one row), within the box.
        const row = k === 'pens' && s.item.kind === 'ink' ? s.rect : s.hit;
        assert.ok(Math.abs(s.caption.y - (row.y + row.height / 2)) <= 20, `${s.item.id} caption level with its row`);
        assert.ok(s.caption.y >= 0 && s.caption.y <= interior.height + 20);
      }
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const o = overlap(slots[i].hit, slots[j].hit);
          assert.ok(o <= stagger + EPS, `${slots[i].item.id} and ${slots[j].item.id} overlap by ${o}`);
        }
      }
    }
  });
}

test('drawerSlots: stacks run front (first, at the bottom) to back; items keep their real size at far scale', () => {
  const l = deskLayout(VIEWPORTS['phone 390×844']);
  const paper = drawerSlots('paper', l, IN_USE);
  for (let i = 1; i < paper.length; i++) assert.ok(paper[i].rect.y < paper[i - 1].rect.y);
  assert.ok(Math.abs(paper[0].rect.width - 148 * 0.68) < EPS && Math.abs(paper[0].rect.height - 210 * 0.68) < EPS);
  assert.ok(Math.abs(paper[0].rect.y + paper[0].rect.height - (l.drawers.paper.depth - 8)) < EPS, 'front stack at the front');
  assert.ok(Math.abs(paper[paper.length - 1].rect.y - 8) < EPS, 'back stack at the back');
  const envelopes = drawerSlots('envelopes', l, IN_USE);
  // A C6 (110 pt at far) is fitted to a phone's side drawer with 4 pt to each wall, so it can lie askew.
  assert.ok(Math.abs(envelopes[0].rect.width - (l.drawers.envelopes.interior.width - 8)) < 0.01, 'a C6 fitted to the drawer');
  const pens = drawerSlots('pens', l, IN_USE);
  const lengths = pens.filter((s) => s.item.kind === 'pen').map((s) => Math.round(s.rect.width));
  assert.deepEqual(lengths, [88, 82, 109]);
  const bottles = pens.filter((s) => s.item.kind === 'ink');
  assert.equal(bottles.length, 4);
  for (let i = 1; i < bottles.length; i++) {
    assert.ok(bottles[i].rect.x - (bottles[i - 1].rect.x + bottles[i - 1].rect.width) >= 3, 'gaps of at least 3 pt');
  }
  // Same layout twice: the same slots (no randomness).
  assert.deepEqual(drawerSlots('paper', l, IN_USE), paper);
});

test('drawerSlots: stacks are never squared up (each turned and shifted its own way), at every size', () => {
  for (const [name, l] of layouts) {
    for (const k of ['paper', 'envelopes'] as const) {
      const slots = drawerSlots(k, l, IN_USE);
      const max = k === 'paper' ? 1 : 1.5;
      const turns = slots.map((s) => (s.rotation * 180) / Math.PI);
      for (const t of turns)
        assert.ok(Math.abs(t) >= 0.2 * max - EPS && Math.abs(t) <= max + EPS, `${name} ${k} turn ${t.toFixed(2)}°`);
      assert.ok(turns.some((t) => t > 0) && turns.some((t) => t < 0), `${name} ${k}: turned both ways`);
      // Left edges spread out (not one ruler-straight column), alternating down the stack.
      const xs = slots.map((s) => s.rect.x);
      assert.ok(
        Math.max(...xs) - Math.min(...xs) >= 1.5,
        `${name} ${k}: x spread ${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} pt`,
      );
    }
  }
});

test('drawerSlots, the pen tray: pens caption alternate sides, each bottle pair on its own side of its row', () => {
  for (const [, l] of layouts) {
    const slots = drawerSlots('pens', l, IN_USE);
    const side = (id: DeskItemId) => slots.find((s) => s.item.id === id)!.caption.align;
    assert.deepEqual(
      ['pen.fine', 'pen.broad', 'pen.glass'].map((id) => side(id as DeskItemId)),
      ['left', 'right', 'left'],
    );
    assert.deepEqual(
      ['ink.blueBlack', 'ink.ironGall', 'ink.violet', 'ink.sapphire'].map((id) => side(id as DeskItemId)),
      ['right', 'right', 'left', 'left'],
    );
  }
});

test('drawerSlots flags exactly what is in use, and hides the new stationery when the flag is off', () => {
  const l = deskLayout(VIEWPORTS['phone 390×844']);
  const inUse = inUseOf({ paper: 'seyes', ink: 'violet', font: 'caveat' }, { paper: 'kraft', liner: 'forest' });
  const used = DRAWERS.flatMap((k) => drawerSlots(k, l, inUse))
    .filter((s) => s.inUse)
    .map((s) => s.item.id);
  assert.deepEqual(used, ['paper.seyes', 'pen.glass', 'ink.violet', 'envelope.kraft.forest']);

  const old = DRAWERS.flatMap((k) => drawerSlots(k, l, IN_USE, { newStationery: false })).map((s) => s.item.id);
  for (const id of ['paper.seyes', 'paper.airmail', 'ink.sapphire']) assert.ok(!old.includes(id as DeskItemId), id);
  assert.equal(old.length, 14);
});

// ---------------------------------------------------------------- picks

const written = (text = 'Привет'): SheetContent => ({ ...emptySheet('grid'), recto: { text, strokes: [] } });
const state = (over: Partial<PickState> = {}): PickState => ({
  blank: false,
  look: LOOK,
  sheets: [written()],
  maxSheets: 4,
  envelope: { paper: 'cream', liner: 'postal' },
  sealed: false,
  ...over,
});

test('applyPick, blank letter: paper re-papers every sheet (recto kept, verso emptied), pens and inks apply', () => {
  const demo: SheetContent = { recto: { text: 'Демо', strokes: [] }, verso: { text: 'оборот', strokes: [] }, twoSided: false };
  const s = state({ blank: true, sheets: [demo] });
  const out = applyPick(s, item('paper.seyes'));
  assert.equal(out.kind, 'apply');
  if (out.kind !== 'apply') return;
  assert.deepEqual(out.look, { ...LOOK, paper: 'seyes' });
  assert.equal(out.look!.seed, LOOK.seed);
  assert.deepEqual(out.sheets, [{ recto: { text: 'Демо', strokes: [] }, verso: { text: '', strokes: [] }, twoSided: true }]);
  assert.equal(out.addSheet, undefined);
  assert.equal(s.sheets[0].verso.text, 'оборот', 'the state is not mutated');

  const cotton = applyPick(state({ blank: true, sheets: [emptySheet('grid')] }), item('paper.cotton'));
  assert.ok(cotton.kind === 'apply' && cotton.sheets?.[0].twoSided === false);

  assert.deepEqual(applyPick(s, item('pen.broad')), { kind: 'apply', look: { ...LOOK, font: 'marckScript' } });
  assert.deepEqual(applyPick(s, item('ink.sapphire')), { kind: 'apply', look: { ...LOOK, ink: 'sapphire' } });
});

test('applyPick, written letter, same paper: next sheet, unless a blank one waits or the envelope is full', () => {
  assert.deepEqual(applyPick(state(), item('paper.grid')), { kind: 'apply', addSheet: true, hint: 'nextSheet' });
  assert.deepEqual(applyPick(state({ sheets: [written(), emptySheet('grid')] }), item('paper.grid')), {
    kind: 'refuse',
    hint: 'blankWaiting',
  });
  const four = [written('1'), written('2'), written('3'), written('4')];
  assert.deepEqual(applyPick(state({ sheets: four }), item('paper.grid')), { kind: 'refuse', hint: 'full' });
  // A quarter fold takes two sheets.
  assert.deepEqual(applyPick(state({ sheets: four.slice(0, 2), maxSheets: 2 }), item('paper.grid')), {
    kind: 'refuse',
    hint: 'full',
  });
});

test('applyPick, written letter, a different paper, pen or ink: refused with its hint', () => {
  assert.deepEqual(applyPick(state(), item('paper.cotton')), { kind: 'refuse', hint: 'paperLocked' });
  assert.deepEqual(applyPick(state(), item('pen.glass')), { kind: 'refuse', hint: 'penLocked' });
  assert.deepEqual(applyPick(state(), item('ink.violet')), { kind: 'refuse', hint: 'inkLocked' });
  // The same pen or ink changes nothing (it is in hand, on the desk).
  assert.deepEqual(applyPick(state(), item('pen.fine')), { kind: 'apply' });
  assert.deepEqual(applyPick(state(), item('ink.blueBlack')), { kind: 'apply' });
});

test('applyPick, envelopes: always apply; a sealed letter asks first, then unseals', () => {
  const kraft = item('envelope.kraft.forest');
  assert.deepEqual(applyPick(state(), kraft), { kind: 'apply', envelope: { paper: 'kraft', liner: 'forest' } });
  assert.deepEqual(applyPick(state({ blank: true }), kraft), { kind: 'apply', envelope: { paper: 'kraft', liner: 'forest' } });

  const sealed = state({ sealed: true });
  assert.deepEqual(applyPick(sealed, kraft), { kind: 'confirm', hint: 'sealedConfirm' });
  assert.deepEqual(applyPick(sealed, kraft, true), {
    kind: 'apply',
    envelope: { paper: 'kraft', liner: 'forest' },
    unseal: true,
  });
  // The envelope it is already sealed in: nothing to undo.
  assert.deepEqual(applyPick(sealed, item('envelope.cream.postal')), {
    kind: 'apply',
    envelope: { paper: 'cream', liner: 'postal' },
  });
});

// ---------------------------------------------------------------- /write: the demo line, re-papering

const DEMO_LINE = 'Привет! Пишу тебе прямо на бумаге.';
const demoSheet = (over: Partial<SheetContent> = {}): SheetContent => ({
  recto: { text: DEMO_LINE, strokes: [] },
  verso: emptyFace(),
  twoSided: true,
  ...over,
});

test('/write: only the demo line is a preview; anything else written locks the look', () => {
  // The demo line alone: blank, and the draft leaves it out.
  assert.equal(isBlankLetter([demoSheet()], true), true);
  assert.ok(withoutDemo([demoSheet()], true).every(isEmptySheet));
  // Its verso written (the demo recto untouched): written. A paper pick refuses instead of wiping the verso.
  const verso = [demoSheet({ verso: { text: 'Моя хорошая, я так скучаю', strokes: [] } })];
  assert.equal(isBlankLetter(verso, true), false);
  assert.equal(withoutDemo(verso, true)[0].verso.text, 'Моя хорошая, я так скучаю');
  assert.deepEqual(applyPick(state({ blank: isBlankLetter(verso, true), sheets: verso }), item('paper.cotton')), {
    kind: 'refuse',
    hint: 'paperLocked',
  });
  // Pen strokes on the demo recto, or a written second sheet: written too (pen and ink locked).
  const drawn = [demoSheet({ recto: { text: DEMO_LINE, strokes: [[[1, 2, 0.5, 0]]] } })];
  assert.equal(isBlankLetter(drawn, true), false);
  const second = [demoSheet(), { ...emptySheet('grid'), recto: { text: 'Целая страница', strokes: [] } }];
  assert.equal(isBlankLetter(second, true), false);
  assert.deepEqual(applyPick(state({ blank: isBlankLetter(second, true), sheets: second }), item('pen.glass')), {
    kind: 'refuse',
    hint: 'penLocked',
  });
  // Once the demo line is edited it is the writer's own text.
  assert.equal(isBlankLetter([demoSheet()], false), false);
});

test('a re-paper to a one-sided paper never leaves the desk on a verso the sheet no longer has', () => {
  const blank = [{ ...emptySheet('grid') }];
  const out = applyPick(state({ blank: true, sheets: blank }), item('paper.cotton'));
  assert.equal(out.kind, 'apply');
  if (out.kind !== 'apply') return;
  assert.equal(out.sheets![0].twoSided, false);
  // DeskStack was on that sheet's verso: it shows (and types into) the recto.
  const onVerso = { sheet: 0, side: 'verso' as const };
  assert.deepEqual(clampFace(onVerso, out.sheets!), { sheet: 0, side: 'recto' });
  // A face it still has is kept as is (the same object); a stack shortened under it clamps the sheet.
  assert.equal(clampFace(onVerso, blank), onVerso);
  assert.deepEqual(clampFace({ sheet: 3, side: 'recto' }, blank), { sheet: 0, side: 'recto' });
});
