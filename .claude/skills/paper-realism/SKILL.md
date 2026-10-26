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

## Imperfection budget (per letter, seeded)
- Fold lines 1–3 mm off the thirds (`creaseOffsets`), slight skew; letter crooked in the envelope; postmark rotated ±8° with partial strike.
- Edges: soft contact shadow (`dy 6, blur 10, ~35 %`) plus a tight 1 px shadow.

## Review checklist (screenshots)
1. Squint test: does anything look perfectly regular (spacing, baselines, rules)?
2. Is any colour pure white/black?
3. Do all shadows agree with `LIGHT_DIR`?
4. Is grain visible but not noisy at 100 %?
5. RU and FR samples both render without fallback glyphs?
