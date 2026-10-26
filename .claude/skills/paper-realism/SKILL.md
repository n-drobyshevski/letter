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

## Two countries
- **The sender's country** decides the postbox and the envelope front; **the recipient's** decides the mailbox. A letter from Paris arrives in a Moscow подъезд box with a French envelope, and the reverse.
- FR envelope front: no printed fields; sender small top-left, address block bottom-right with the city in CAPITALS and the country last; stamp «RF» + «MONDE» (international stamps carry no value); postmark CITY over the top, FRANCE under, date `dd-mm yy`.
- Never a real postal logo or brand mark (Почта России, La Poste): original emblems, generic words («ПОЧТА», «LETTRES»).

## Steel boxes (`steelBox.ts`, `POWDER_SKSL`)
- Powder coat: orange-peel micro-normals under the desk light, slow dent waviness, lighter at the top, chips to grey primer only near edges, grime patches.
- Postbox: RU 2015 wall box, blue (#2766C5; express = real yellow), visor with soft shadow over a 171 × 6 mm slot at 1.6 pt/mm, «ПОЧТА» + an original emblem (never the Почта России logo), hand-filled collection sticker kept on screen.
- FR street box: La Poste yellow #FFCB05, a blue band reading LETTRES, wide slot (250 × 20 mm, estimate), an enamel plate printed «HEURE LIMITE DE DÉPÔT 14 h 37» (printed, not handwritten, unlike the RU sticker).
- Mailbox RU: подъезд bank, RAL 7035, numbered doors, cylinder lock, slot, six peek holes; our door is live, neighbours are baked. Mail shows as pale holes (4 for one letter, all 6 for more).
- Mailbox FR: batterie, anthracite RAL 7016, 260 × 260 mm doors, 235 × 26 mm slot with an inner flap, aluminium-framed nameplate with the name in capitals. Mail shows as envelope corners drooping out of the slot (up to 3, offset), then a chalked «+N».
- An object going into a slot darkens as it enters (a gradient in its own space): a clip alone looks like a mask.

## Tracking map (`TrackingMap.tsx`, `scripts/build-map.mjs`)
- Natural Earth 1:50m (world-atlas), Lambert conformal conic (parallels 47°/56°, rotate −15°), baked to `assets/map/europe.json` (≤ 60 KB). The app re-projects with `tracking/project.ts` (tested against d3, < 0.5 px).
- Old atlas plate: waterlined sea (4 widening coast strokes, fading), warm paper land, the couple's two countries washed in watercolour, coast inked twice (a `Discrete`-wobbled line over a fine one), dash-dot borders clipped to land, names in their own languages in spaced capitals, a neat-line frame.
- Sizes are specified in screen points and divided by the zoom when baking, so text stays legible at any size.
- Route: pencil dashes for the plan, ink for the travelled part (trimmed `<Path end>`, replayed in 2.5 s on open), the envelope (with a red R label) parked at the last scan, tiny calendar postmarks at the hubs reached, and during silences a pencil circle «где-то здесь?» at the estimated position.

## Wax types
- **Brittle** (traditional sealing wax): may crack in the post (hairline crack on delivery) and snaps when opened.
- **Flexible** (modern glue-gun wax): survives the post intact; under the pull it stretches and bends along the flap edge, then lets go of the paper whole and leaves with the flap, leaving a faint film (≤ 8 % wax colour) and a few lifted fibres on the body. No crumbs.

## Wax seal (`WAX_SKSL`)
- Height-field shading with the desk light: noisy seeded outline, rounded puddle edge, flat stamp face with the monogram raised, a rim of wax pushed out around the stamp. Normals from finite differences.
- Molten wax is glossier (higher, tighter specular); pressed wax goes satin. Thin edges glow slightly.
- Too little wax → the imprint is cut off at the edge. That's correct; keep it.
- Grain on the stamp face must be low-frequency (≥ ~4 px features). 1 px noise reads as a checkerboard.
- Breaking (`sealBreak.ts`): brittle wax splits along the flap's edge (jagged random walk through the wax, exact paper edge elsewhere). Draw the same `WaxSeal` twice, clipped to the flap piece and to its inverse (`invertClip`), so the halves match perfectly before they separate. The body half gets a faint lit lip along the break. 3–5 faceted crumbs (1.3–4 pt) fly up and land. Under the flap, the gum line shows paper fibres torn away on 30–60 % of its length (rough `DiscretePathEffect` strokes, never a regular dash).
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

## Envelope formats
- One per fold (ISO 269): tri-fold → DL 220×110, half (A5) → C5 229×162, quarter (A6, turned sideways) → C6 162×114. `envelopeGeometry(width, seed, format)`; `formatForFold`.
- Printed and written things keep their real size across formats: size them from `g.unit` (a DL's height at this scale), place them as fractions of the envelope. A DL renders exactly as before.
- At the RU 171 mm slot a DL or C5 turns to go in short edge first; a C6 goes in long edge first. In the mailbox, formats keep their size relative to each other.
