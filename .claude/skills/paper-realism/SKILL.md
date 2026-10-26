---
name: paper-realism
description: Rules and reference values for rendering paper, ink, handwriting, envelopes, stamps and seals in this app. Use for any component or shader that draws stationery (src/letter/*, src/theme/stationery.ts), and when reviewing screenshots from `npm run qa:visual`.
---

# Paper realism

The illusion breaks on the *first* digital-looking detail. Every rule below exists because its absence reads as "app".

## Non-negotiables
- **No pure white, no pure black.** Paper base lives in `PAPERS[*].base` (≈ 0.93–0.97); inks in `INKS` (blue-black `#1f2b4d`, iron-gall `#3b2a22`, violet `#41306e`).
- **One light** for the whole desk: `LIGHT_DIR` (top-left, slightly in front). Shadows fall bottom-right; crease shading, panel shading and wax highlights all use it.
- **Everything seeded.** Randomness comes from `mulberry32(subSeed(letter.seed, '<purpose>'))` (`src/lib/random.ts`). Never `Math.random()` in rendering — both phones must draw the identical sheet.
- **Bake, then move.** Paper + ink are recorded once into an `SkPicture` (`recordLetter`); animations transform pictures and uniforms, never re-layout text per frame.
- **Group opacity does not affect `<Picture>`.** Use clips (`FoldableLetter`) or a layer paint (`<Group layer={<Paint opacity={…} />}>`).
- **Web `Canvas` style must be a flat object** (`StyleSheet.flatten`).

## Paper
- Shader: `PAPER_SKSL` in `src/letter/shaders.ts` — mottling (fbm ~0.0045), grain (~0.85), fibres (anisotropic fbm), printed rules with uneven strike, tri-fold creases that never fully vanish (`uCrease` 1 → ~0.35 after reading), faint edge darkening.
- Grain/mottle amplitude stays within 4–8 %; if it is visible at arm's length it is too strong.
- Russian notebook (`grid`): ~30 cells across, grey-blue rules at ~40 % strength, **red/pink margin on the right**, baselines exactly on grid lines, writing on every second line (`writingArea`).
- Cotton: warm, no rules, more bleed.

## Handwriting (typed)
- Fonts must cover RU + FR; `tests/fonts.test.ts` enforces it. Allowed: Bad Script, Marck Script (native Russian cursive), Caveat. Never Homemade Apple, Reenie Beanie, La Belle Aurore (Latin only).
- Shape **whole words** (keeps contextual alternates); jitter per word only (`layoutHandwriting`): baseline ±1.4 px, rotation ±1°, scale ±2.5 %, per-line slope ±0.6 %, margin wobble ±3 px, ink load 0.8–1 with a re-dip every 40–80 chars.
- Ink: multiply blend, `INK_SKSL` density noise, a faint blurred halo for feathering (stronger on cotton).
- Paragraph indents come from the writer's own leading spaces — never auto-indent (the native TextInput would disagree).

## Hand-drawn
- `perfect-freehand` via `strokeToPath`; pressure from speed for fingers (`pressureFromSpeed`), real pressure for styluses.
- Wet ink is darker while drawing, dries to the ink colour; store strokes as `[x, y, p, t]` for replay.

## Envelope (`src/letter/envelope.ts`)
- DL proportions (2:1), "wallet" back: side flaps under the bottom flap, closing flap on top.
- The closing flap must cover the whole pocket opening: side-flap tips sit *above* its edges, or the inside shows through as a sliver.
- Each flap gets its own paper seed and a ±2–3 % tint (no two flaps are lit identically), a tiny drop shadow on its edges, and the far wall is in shade (darker towards the bottom).
- Inside: liner with a fine "security" diamond pattern (`LINER_SKSL`); the flap's inside carries a gum strip along both edges.
- Folded letter (`recordFoldedLetter`): back of the top third on top, mirrored show-through at ~4.5 % *blurred* (crisp ghost text reads as print), faint lines where hidden panel edges press through.

## Envelope front (`envelopeFront.ts`)
- Russian printed fields «От кого / Откуда / Кому / Куда» + the six-box index template, in a printed slate ink; filled in by hand (`layoutHandwriting`, one line each).
- Stamp: perforations by clipping a row of circles out of the stamp paper, offset-print landscape, «РОССИЯ», value, year; tilted ±2°.
- Postmark: double ring, city over the top, «ПОЧТА» under, date between two bars; rotated ±8°; `STAMP_INK_SKSL` coverage — patchy, one side lighter but never gone. **Normal blending**, not multiply (multiply vanishes over the stamp's dark colours). Machine cancellation waves run off to the left.
- Transit wear (received letters): grime vignette, a few smudges, a dog-eared corner, a hairline crack in the wax (`WaxSeal cracked`).

## Steel boxes (`steelBox.ts`, `POWDER_SKSL`)
- Powder coat: orange-peel micro-normals under the desk light, slow dent waviness, lighter at the top, chips to grey primer only near edges, grime patches.
- Postbox: RU 2015 wall box, blue (#2766C5; express = real yellow), visor with soft shadow over a 171 × 6 mm slot at 1.6 pt/mm, «ПОЧТА» + an original emblem (never the Почта России logo), hand-filled collection sticker kept on screen.
- Mailbox: подъезд bank, RAL 7035, numbered doors, cylinder lock, slot, six peek holes; our door is live, neighbours are baked.
- An object going into a slot darkens as it enters (a gradient in its own space): a clip alone looks like a mask.

## Wax seal (`WAX_SKSL`)
- Height-field shading with the desk light: noisy seeded outline, rounded puddle edge, flat stamp face with the monogram raised, a rim of wax pushed out around the stamp. Normals from finite differences.
- Molten wax is glossier (higher, tighter specular); pressed wax goes satin. Thin edges glow slightly.
- Too little wax → the imprint is cut off at the edge. That's correct; keep it.
- Grain on the stamp face must be low-frequency (≥ ~4 px features). 1 px noise reads as a checkerboard.
- Iterate on looks in Node with CanvasKit (render the shader to PNG) before wiring it into the app.

## Imperfection budget (per letter, seeded)
- Fold lines 1–3 mm off the thirds (`creaseOffsets`), slight skew; letter crooked in the envelope; postmark rotated ±8° with partial strike.
- Edges: soft contact shadow (`dy 6, blur 10, ~35 %`) plus a tight 1 px shadow.

## Review checklist (screenshots)
1. Squint test: does anything look perfectly regular (spacing, baselines, rules)?
2. Is any colour pure white/black?
3. Do all shadows agree with `LIGHT_DIR`?
4. Is grain visible but not noisy at 100 %?
5. RU and FR samples both render without fallback glyphs?
