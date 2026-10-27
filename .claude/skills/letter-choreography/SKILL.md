---
name: letter-choreography
description: How to build the letter "ceremonies" (fold, insert, seal, stamp, post, receive, slit, unfold) as gesture-driven Reanimated/Skia animations with sound and haptics. Use when adding or changing any animated moment in the app.
---

# Letter choreography

## Pattern
- One ceremony = one `SharedValue` `t ∈ [0, 1]` plus pure worklet functions `t → state` (angles, offsets, opacities). Reference: `src/letter/FoldableLetter.tsx`. The one exception is reading a stack: `turn ∈ [0, faces − 1]` walks the faces (`ReadingStack`, `?turn=`).
- The finger writes `t` directly (`usePanGesture` → `t.set(...)`); on release settle with `withSpring(target, { velocity })` so a flick carries through. Never a fixed-duration tween for something the hand started.
- With React Compiler on, use `.get()/.set()` on shared values in JS-thread code and gesture callbacks.
- Sub-phases are ranges of `t` with an ease (`t/0.5`, `(t-0.5)/0.5`), so scrubbing backwards always works.
- Expose a `fixedT` prop (and `?t=` lab param) so `npm run qa:visual` can freeze any frame.

- Multi-stage ceremonies (`EnvelopeCeremony`): one progress value per stage plus a `stage` shared value. **Lock each gesture to the stage it began in** (`gestureStage`); otherwise a drag that completes stage N keeps driving stage N+1.
- On web, a tap without movement never activates a pan: `onActivate`/`onDeactivate` don't fire, only `onBegin`/`onFinalize`. Handle taps in `onFinalize`.
- With `minDistance: 0` a tap *does* activate on native (handle it in `onDeactivate` by tiny translation), and on web it does not (handle it in `onFinalize` unless `onDeactivate` already ran). Handle both.
- **Never commit on `e.canceled`** (a call, a scroll taking over): spring back instead.
- Action props (`advanceKey`, `commitKey`, `retrieveKey`) only count when they change *while mounted*; a remount (next letter) must not replay the last press.
- Every gesture has a tap/button alternative (`advanceKey`/`commitKey` props, `EnvelopeCeremony`'s `command`); it leads when `useMotionPrefs().needsButtons`, otherwise it stays on screen as a quiet link. On web `needsButtons` is Reduce Motion only (React Native Web can't detect a screen reader and always says yes).
- **Perspective must be in the same `transform` list as the rotation.** Each `Group` flattens its matrix to 2D, so `perspective` on a parent group does nothing. Put the vanishing point on the hinge's mid-line (`origin`).
- Choosing between two gestures in one stage (knife vs seal): decide on `onBegin` by where the finger lands, lock it with a `mode` shared value, and reset the choice if nothing happened.
- Time-based physics after a gesture event (wax crumbs): closed-form motion of a `withTiming` 0→1 value, so a frozen QA frame shows exactly where each piece is.
- Hold-to-do (pouring wax): start a `withTiming` in `onBegin`, `cancelAnimation` in `onFinalize`, and keep what was done.
- Tap vs hold vs drag in one stage (placing the die): decide with a `withDelay` clock watched by `useAnimatedReaction` (a busy frame can't turn a tap into a hold), plus movement > 8 pt; settle taps in `onFinalize`.
- Reanimated's `withTiming`/`withDelay` default to `ReduceMotion.System`: with Reduce Motion on they jump to the end. Animations that are **clocks** (a hold-to-pour, a tap-vs-hold timer, cooling, a press timeline whose callback commits) must pass `reduceMotion: ReduceMotion.Never` and shorten their duration by hand instead.
- A derived value or animated reaction only subscribes to shared values read **directly in its own closure**, not inside helper worklets it calls: read them inline (`EnvelopeCeremony`'s `live`).
- **A whole scene can move without a single redraw** (the writing desk, `src/letter/desk/`): every canvas is static (drawn once, `__destroyWebGLContextAfterRender` on web) and only `Animated.View` transforms (`translateY`, `scale`, `rotate`, `opacity`) are driven from shared values. No Skia value on that screen follows a shared value; no React render per frame. A keystroke must not redraw the desk either: give its canvases primitive props (`?debug=1` counts renders).

## Physics cues
- Nothing moves at constant velocity. Falls ease in; landings settle with a damped spring (damping ~18–22, stiffness ~140–160).
- Hinged panels: rigid planes, `perspective ~1100`, max angle < 180° (`0.985π`) — paper never lies perfectly flat. Swap front/back face at 90° (clip, not opacity).
- Moving paper casts shadow on what lies beneath; the contact shadow shrinks to what still touches the desk.

## Sound & haptics
- Haptics vocabulary in `src/lib/haptics.ts` (`crease`, `tick`, `press`, `posted`; the desk's `knock` (a drawer meets its stop), `shut`, `lift`). Fire from `useAnimatedReaction` threshold crossings via `scheduleOnRN`, only on forward crossings.
- Sounds: one-shots at the same thresholds; continuous rustle/tear gain follows gesture velocity. 3–5 variants per sound, picked by seed. Ambient audio session (respect the mute switch, don't stop the user's music); "sound on silent" is a setting.

## Pacing
- First opening of a letter: full gesture-driven ceremony, 5–8 s. **Re-reading skips straight to the unfolded sheet.**
- `useReducedMotion()` → short timing crossfades instead of sequences.
- Keep system chrome out of ceremonies (full-bleed `Desk`, no tab bar).

## Ceremony map (MVP)
| Moment | Gesture | Feedback |
|---|---|---|
| Fold: in three | drag up from below | `crease` per panel |
| Fold: in half / in four | pull the top edge down; then swipe left | `crease` per fold |
| Insert into envelope | drag down + page curl | rustle |
| Close flap | tap | soft thud |
| Wax seal (`EnvelopeCeremony` stage 2, `mode` ready → pouring → wax → carry → drop) | hold where the seal should go: the first drop lands exactly under the finger after 120 ms, the puddle grows while held (`R = maxR·√v`), moving steers it (drift ≤ 0.6 maxR, a flick throws ≤ 2 drops); hold on the puddle again to add a layer; pick a die in the tray; tap where to press it, or drag the stamp there (rides 56 pt above a finger, under a mouse); turn it with a two-finger twist, the wheel, `[` `]`, or ↺ ↻ (15° clicks, snaps upright within 3°); the die drops on release; off the wax it bounces back («Мимо сургуча»). The wax cools over 8 s + 6 s·v (no clock when `needsButtons`): pressed late, the relief is shallow. Buttons for all of it (`command`); a tap aims the pour button (crosshair). A tap too quick for the first drop still leaves a drip. A mouse: the stick follows it before and during the pour, the die floats see-through over the wax with a ring where its face lands, the system cursor is hidden only while one of them is under it. A resize mid-ceremony scales the seal with the envelope | `tick` first drop and every 0.2 of wax, second pour, pickup, miss; `crease` on die pick and the upright snap; `fibre` every 15°; `press` on impact |
| Stamp / postmark | tap | `press` |
| Post (`PostingCeremony`) | drag/flick up: tilt out of the wall (RU box: also turn to portrait, short edge first; FR box: long edge first) → through the slot; commit ≥ 0.55 or flick ≤ −900 pt/s | `tick` at contact and when the seal catches the lip, `posted` on the drop, `clack` as the inner flap swings back |
| Take back (grace window) | button | reverse, 600 ms ease-out |
| Mailbox door (`ReceivingCeremony`) | tap (unlock + open) or drag right | `door` |
| Take out / flip | drag up or tap / tap | `crease` / `tick` |
| Slit with paper knife | drag along the top fold from either corner; auto-finishes past 0.92 | `fibre` at seeded stick-slip catches (18–30 pt) |
| Break the seal (alternative to the knife, only when the seal straddles the flap edge; a decorative seal leaves the knife; flexible wax peels off whole with `peel`) | touch the seal (its real outline, wherever it is) and pull up: 0–14 pt strain (hairline crack, flap rises 1 pt), snap at 14 pt, then the flap swings open with the finger; released before the snap it holds, after it the flap opens past 0.55 or falls back | `crack` once on the snap |
| Pull letter out | drag up | `crease` |
| Next letter | button after reading | back to the open box (door stage skipped), oldest unopened first; the rest lie underneath |
| Unfold | `FoldableLetter initialT={1}`, drag down | `crease` per panel |
| Turn a page at the desk (`DeskStack`) | take the sheet anywhere along its right edge and drag left (forward: over to the back, then the next sheet), along its left edge and drag right (back: the previous page returns); only 30 pt edge strips take the drag, so pen and keyboard keep the sheet. The turn follows the hand (`gripOf`): the axis leans square to the drag and toward where the edge was taken (top corner taken → top leads), ≤ 29°, with a twist that lands the far face upright; the sheet travels ~5 % with the hand; a slide to another sheet goes the way it was pushed. Release past 0.5 or a flick completes, else it falls back; buttons «Перевернуть» / «Лист →» / «← Лист» turn square. A Skia overlay (with room around the sheet) draws the turn; the desk underneath is hidden and changes face when it lands | `tick` as the edge passes upright |
| Another sheet at the desk | «Ещё лист»: the written sheet slides aside, the blank one lies underneath | — |
| Read a stack (`ReadingStack`) | drag anywhere on the sheet: leftward reads on, rightward goes back (`activeOffsetX ±12`; a mostly vertical drag, past ±30 first, still scrolls the desk; `touchAction: pan-y`). The turn follows the hand as at the desk (`gripOf`): axis leans with the drag and where the sheet was taken, the sheet travels with the hand, a read sheet slides off (and a previous one returns) the way it was pushed, mostly sideways. Release springs to the nearest face, at most one per gesture; canceled → back. The canvas has room above and below (negative margin on a wrapper View) so a leaning turn is never clipped | `tick` on a turn over, `fibre` as a read sheet slides to the back |
| Open a drawer (`DeskScene`, `useDrawers`) | drag the front up: it follows the finger 1:1 over its travel D while the camera pans the desk up by C = H + D (`lift = max(tᵢ·Cᵢ)`); a down-tug (rubber band, ≤ 6 pt) or a tap also opens it; release by `settleTarget` (projection 0.15 s, ±600 pt/s); open spring stiffness 170 / damping 22 (meets its stop), close the same clamped, from a tap damping 26. Opening one drawer closes the other in parallel; a moving front can be caught. Close: tap the front, push it down, tap the desk above, or start typing. Locked while a sheet turns or the keyboard is up (native: the band slides away, 220 ms). Web: hover eases it out to 0.03, `grab` cursor. First blank visit: the paper drawer breathes once (0 → 0.06 → 0). Reduce Motion: no pan, the drawer crossfades in as a panel (150 ms) over the dimmed desk. `?drawer=&dt=` freezes one | `knock` as t crosses 0.98, `shut` as it crosses 0.02 after 0.3 |
| Take from a drawer (`CarryLayer`) | tap an item (< 8 pt, < 250 ms), or drag it 8 pt: it lifts (×1.05, 120 ms, the shadow grows, tilts ±4° with the horizontal speed) and rides 56 pt above a finger (under a mouse at the grab point); dropped above the drawer's desk edge it is taken, inside it springs home. Taken: it flies from the release velocity onto the sheet (paper), to its resting place beside the sheet (laptop) or away off the top right (phone), fades into the redrawn scene, and the drawer closes 300 ms later (stays open with `needsButtons`). Refused (`applyPick`: the letter is written in another paper, pen or ink): a ±3° wiggle, 2 cycles in 240 ms, and the hint. A sealed letter asks before changing envelope («Взять» / «Оставить»). The carry canvas is drawn at the destination scale and shown scaled down, so it never upsamples. `?item=` shows one lifted | `lift` on lift (or a tap's take), `tick` on landing |
